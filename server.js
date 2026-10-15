const express = require('express');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const path = require('path');
const AdmZip = require('adm-zip');
const Student = require('./models/Student');
const User = require('./models/User');
const { getRequestUser, requireAuth, requireRole } = require('./middleware/auth');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set before starting the server.');
}

const app = express();
const PORT = process.env.PORT || 5000;
const distPath = path.join(__dirname, 'student-web-portal-main', 'dist');
const COOKIE_NAME = 'st_showcase_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const MAX_ARCHIVE_FILES = MAX_UPLOAD_FILES;
const allowedDepartments = Student.schema.path('department').enumValues;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_UPLOAD_FILES }
});
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const loginAttemptLimit = 10;
let bucket;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/assets', express.static(path.join(distPath, 'assets'), { index: false }));

app.get(/^\/api\/showcase\/sites\/([a-f\d]{24})\/(.+)$/i, (req, res, next) => {
  const studentId = req.params[0];
  if (!isShowcaseAssetTokenValid(req.query.access, studentId)) return next();
  return streamShowcaseSite(req, res, next, studentId, req.params[1]);
});

function createAuthToken(user) {
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name || '',
    email: user.email,
    role: user.role,
    rollNumber: user.rollNumber || '',
    department: user.department || '',
    isApproved: user.isApproved,
    isEnabled: user.isEnabled
  };
}

function sendLoginCookie(res, user) {
  res.cookie(COOKIE_NAME, createAuthToken(user), COOKIE_OPTIONS);
}

function clearLoginCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_OPTIONS.secure, sameSite: 'lax', path: '/' });
}

function createShowcaseAssetToken(studentId) {
  return jwt.sign(
    { purpose: 'showcase-project-assets', studentId: String(studentId) },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );
}

function isShowcaseAssetTokenValid(token, studentId) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    return claims.purpose === 'showcase-project-assets' && claims.studentId === String(studentId);
  } catch {
    return false;
  }
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function normalizeRoll(value) {
  return String(value || '').trim().padStart(2, '0');
}

function setLoginThrottle(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetAt <= now) loginAttempts.delete(key);
  const latest = loginAttempts.get(key);
  if (latest && latest.count >= loginAttemptLimit) {
    res.set('Retry-After', String(Math.ceil((latest.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
  }
  req.loginThrottleKey = key;
  next();
}

function recordFailedLogin(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs });
  } else {
    current.count += 1;
  }
}

function clearFailedLogins(key) {
  loginAttempts.delete(key);
}

function getMime(filename) {
  const extension = path.extname(filename).toLowerCase();
  const types = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.zip': 'application/zip'
  };
  return types[extension] || 'application/octet-stream';
}

function safeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Invalid project file path.');
  }
  return segments.join('/');
}

function projectEntryPath(student) {
  const files = student.files || [];
  const entryFile = files.filter(file => path.posix.basename(file.filename || '').toLowerCase() === 'index.html').at(-1)
    || files.filter(file => String(file.filename || '').toLowerCase().endsWith('.html')).at(-1);
  if (entryFile) return safeRelativePath(entryFile.filename);

  if (student.websitePath) {
    const websiteSegments = safeRelativePath(student.websitePath).split('/');
    if (websiteSegments[0] === 'submissions' && websiteSegments.length >= 3) {
      return websiteSegments.slice(2).join('/');
    }
  }
  return '';
}

function rewriteProjectResourceUrl(value, studentId, currentPath, token) {
  const resource = value.trim();
  if (!resource || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(resource)) return value;

  let parsed;
  try {
    const directory = path.posix.dirname(currentPath);
    parsed = new URL(resource, `http://project.local/${directory === '.' ? '' : `${directory}/`}`);
  } catch {
    return value;
  }
  if (parsed.origin !== 'http://project.local') return value;

  let relativePath;
  try {
    relativePath = safeRelativePath(decodeURIComponent(parsed.pathname.slice(1)));
  } catch {
    return value;
  }

  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  parsed.searchParams.set('access', token);
  return `/api/showcase/sites/${studentId}/${encodedPath}?${parsed.searchParams.toString()}${parsed.hash}`;
}

function rewriteProjectCss(css, studentId, currentPath, token) {
  const rewrite = value => rewriteProjectResourceUrl(value, studentId, currentPath, token);
  return css
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, value) => `url(${quote}${rewrite(value)}${quote})`)
    .replace(/(@import\s+)(["'])(.*?)\2/gi, (match, prefix, quote, value) => `${prefix}${quote}${rewrite(value)}${quote}`);
}

function rewriteProjectHtml(html, studentId, currentPath, token) {
  const rewrite = value => rewriteProjectResourceUrl(value, studentId, currentPath, token);
  return html
    .replace(/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi, (match, attribute, quote, value) =>
      `${attribute}=${quote}${rewrite(value)}${quote}`)
    .replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (match, quote, value) =>
      `style=${quote}${rewriteProjectCss(value, studentId, currentPath, token)}${quote}`)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (match, opening, css, closing) =>
      `${opening}${rewriteProjectCss(css, studentId, currentPath, token)}${closing}`);
}

function setProjectResponseHeaders(res, contentType, filename) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Type', contentType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${path.basename(filename).replace(/["\r\n]/g, '_')}"`);
  res.set('Referrer-Policy', 'no-referrer');
  const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType === 'text/html' || mediaType === 'image/svg+xml') {
    res.set('Content-Security-Policy', 'sandbox allow-scripts');
  }
  res.set('X-Content-Type-Options', 'nosniff');
}

async function sendShowcaseFile(res, readable, studentId, relativePath, contentType) {
  const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'text/html' && mediaType !== 'text/css') {
    setProjectResponseHeaders(res, contentType, relativePath);
    return readable.pipe(res);
  }

  const chunks = [];
  for await (const chunk of readable) chunks.push(chunk);
  let body = Buffer.concat(chunks).toString('utf8');
  const accessToken = createShowcaseAssetToken(studentId);
  body = mediaType === 'text/html'
    ? rewriteProjectHtml(body, studentId, relativePath, accessToken)
    : rewriteProjectCss(body, studentId, relativePath, accessToken);
  setProjectResponseHeaders(res, contentType, relativePath);
  return res.send(body);
}

function streamBufferToGridFS(buffer, filename, contentType, metadata) {
  return new Promise((resolve, reject) => {
    if (!bucket) return reject(new Error('File storage is not ready.'));
    const stream = bucket.openUploadStream(filename, { contentType, metadata });
    stream.once('finish', () => resolve({ _id: stream.id, filename }));
    stream.once('error', reject);
    stream.end(buffer);
  });
}

async function deleteStudentFiles(student) {
  if (!bucket) return;
  for (const entry of student.files || []) {
    if (entry.fileId) {
      try {
        await bucket.delete(new ObjectId(entry.fileId));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

async function findStudentByIdentity(rollNumber, department) {
  if (department) {
    return { student: await Student.findOne({ rollNumber, department }), ambiguous: false };
  }
  const matches = await Student.find({ rollNumber }).limit(2);
  return { student: matches[0] || null, ambiguous: matches.length > 1 };
}

async function bootstrapAdmin() {
  const existingAdmin = await User.exists({ role: 'admin' });
  if (existingAdmin) return;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validatePassword(password)) {
    throw new Error('No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) to bootstrap the first admin.');
  }
  await User.create({
    name: 'Administrator',
    email,
    password,
    role: 'admin',
    isApproved: true,
    isEnabled: true
  });
  console.log(`Initial administrator account created for ${email}`);
}

async function linkLegacyStudentAccounts() {
  const accounts = await User.find({ role: 'student', rollNumber: { $exists: true, $ne: '' } });
  for (const account of accounts) {
    const rollNumber = normalizeRoll(account.rollNumber);
    const student = await Student.findOne({ rollNumber, department: account.department });
    if (!student || student.userId) continue;
    if (student.email && student.email.toLowerCase() !== account.email.toLowerCase()) {
      console.warn(`Skipped linking account ${account.email}: its student record email does not match.`);
      continue;
    }
    student.userId = account._id;
    student.email = account.email;
    await student.save();
  }
}

async function ensureStudentIndexes() {
  const students = await Student.find({}, { department: 1, rollNumber: 1 }).lean();
  const identities = new Set();
  const duplicates = new Set();
  for (const student of students) {
    const identity = `${student.department}\u0000${normalizeRoll(student.rollNumber)}`;
    if (identities.has(identity)) duplicates.add(identity);
    identities.add(identity);
  }
  if (duplicates.size) {
    throw new Error(`Cannot enforce department-scoped roll-number uniqueness: ${duplicates.size} duplicate student identity group(s) exist.`);
  }

  let indexes = await Student.collection.indexes();
  const identityIndexes = indexes.filter(index =>
    index.key.department === 1 && index.key.rollNumber === 1 && Object.keys(index.key).length === 2
  );
  const uniqueIdentityIndex = identityIndexes.find(index => index.unique);
  if (!uniqueIdentityIndex) {
    for (const index of identityIndexes) {
      await Student.collection.dropIndex(index.name);
    }
    await Student.collection.createIndex(
      { department: 1, rollNumber: 1 },
      { unique: true, name: 'department_1_rollNumber_1' }
    );
  }

  indexes = await Student.collection.indexes();
  const userIndex = indexes.find(index => index.key.userId === 1 && Object.keys(index.key).length === 1);
  if (!userIndex) {
    await Student.collection.createIndex({ userId: 1 }, { unique: true, sparse: true });
  } else if (!userIndex.unique || !userIndex.sparse) {
    throw new Error('The student userId index must be unique and sparse.');
  }
}

// Public entry points: login, registration, and static assets only.
app.get('/', async (req, res, next) => {
  try {
    let user = null;
    try {
      user = await getRequestUser(req);
    } catch (error) {
      if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') throw error;
      clearLoginCookie(res);
    }
    if (!user) return res.sendFile(path.join(distPath, 'login.html'));
    return res.redirect(user.role === 'admin' ? '/admin.html' : '/dashboard.html');
  } catch (error) {
    next(error);
  }
});

app.get('/login.html', (req, res) => res.sendFile(path.join(distPath, 'login.html')));
app.get('/account.html', (req, res) => res.sendFile(path.join(distPath, 'account.html')));
app.get('/register.html', (req, res) => res.redirect('/account.html'));

app.get('/api/auth/register', async (req, res, next) => {
  try {
    res.json({ departments: allowedDepartments });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', async (req, res) => {
  let createdUser;
  let linkedStudent;
  let originalStudentEmail;
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const rollNumber = normalizeRoll(req.body.rollNumber);
    const department = String(req.body.department || '').trim();
    if (!name || !email || !rollNumber || !department || !password) {
      return res.status(400).json({ message: 'Name, email, password, roll number, and department are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' });
    }
    if (!allowedDepartments.includes(department)) {
      return res.status(400).json({ message: 'Choose a valid engineering department.' });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const student = await Student.findOne({ rollNumber, department });
    if (student?.userId) {
      return res.status(409).json({ message: 'This student profile is already linked to an account. Contact the administrator.' });
    }
    if (student?.email && student.email.toLowerCase() !== email) {
      return res.status(409).json({ message: 'The email does not match the student record. Contact the administrator.' });
    }

    createdUser = await User.create({
      name: student?.name || name,
      email,
      password,
      role: 'student',
      rollNumber,
      department,
      isApproved: false,
      isEnabled: true
    });
    if (student) {
      linkedStudent = student;
      originalStudentEmail = student.email;
      student.userId = createdUser._id;
      student.email = email;
      await student.save();
    } else {
      linkedStudent = await Student.create({
        userId: createdUser._id,
        name,
        email,
        rollNumber,
        department
      });
    }
    return res.status(201).json({
      message: 'Registration received. An administrator must approve your account before you can sign in.'
    });
  } catch (error) {
    if (createdUser && linkedStudent?._id) {
      const rollback = { $unset: { userId: 1 } };
      if (originalStudentEmail === undefined) rollback.$unset.email = 1;
      else rollback.$set = { email: originalStudentEmail };
      await Student.updateOne({ _id: linkedStudent._id, userId: createdUser._id }, rollback).catch(cleanupError => {
        console.error('Registration rollback could not unlink student profile:', cleanupError);
      });
    }
    if (createdUser) {
      await User.findByIdAndDelete(createdUser._id).catch(cleanupError => {
        console.error('Registration rollback could not remove account:', cleanupError);
      });
    }
    if (error.code === 11000) return res.status(409).json({ message: 'This student profile or email is already registered.' });
    console.error('Student registration error:', error);
    return res.status(500).json({ message: 'Student registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', setLoginThrottle, async (req, res) => {
  const key = req.loginThrottleKey;
  try {
    const identifier = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ loginId: identifier })
      || await User.findOne({ email: identifier });
    if (!user || !(await user.comparePassword(password))) {
      recordFailedLogin(key);
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (!['admin', 'student'].includes(user.role)) {
      recordFailedLogin(key);
      return res.status(403).json({ message: 'This account role is not supported.' });
    }
    if (!user.isEnabled) return res.status(403).json({ message: 'This account is disabled. Contact the administrator.' });
    if (user.role === 'student' && !user.isApproved) {
      return res.status(403).json({ message: 'Your registration is awaiting administrator approval.' });
    }
    if (user.role === 'student' && !await Student.exists({ userId: user._id })) {
      return res.status(403).json({ message: 'No student profile is linked to this account. Contact the administrator.' });
    }
    clearFailedLogins(key);
    sendLoginCookie(res, user);
    return res.json({ user: publicUser(user), redirectTo: user.role === 'admin' ? '/admin.html' : '/dashboard.html' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearLoginCookie(res);
  res.json({ message: 'Signed out.' });
});

// The remainder of the site and API requires a valid account.
app.use('/api', requireAuth);
app.use('/submissions', requireAuth);

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = publicUser(req.user);
    if (req.user.role === 'student') {
      const student = await Student.findOne({ userId: req.user._id }).lean();
      return res.json({ user, student });
    }
    return res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/account-settings', requireRole('admin'), async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const email = String(req.body.email || '').trim().toLowerCase();
    const newPassword = String(req.body.newPassword || '');
    if (!currentPassword) {
      return res.status(400).json({ message: 'Enter your current password to save account settings.' });
    }
    if (!email && !newPassword) {
      return res.status(400).json({ message: 'Enter a new email address or password.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (newPassword && (newPassword.length < 10 || newPassword.length > 128)) {
      return res.status(400).json({ message: 'The new password must be between 10 and 128 characters long.' });
    }
    if (!(await req.user.comparePassword(currentPassword))) {
      return res.status(401).json({ message: 'The current password is incorrect.' });
    }
    if (email && email !== req.user.email) {
      const existing = await User.findOne({ email, _id: { $ne: req.user._id } });
      if (existing) return res.status(409).json({ message: 'That email address is already in use.' });
      req.user.email = email;
    }
    if (newPassword) req.user.password = newPassword;
    await req.user.save();
    res.json({ message: 'Account settings updated.', user: publicUser(req.user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That email address is already in use.' });
    next(error);
  }
});

app.get('/api/student/me', requireRole('student'), async (req, res, next) => {
  try {
    const student = await Student.findOne({ userId: req.user._id }).lean();
    if (!student) return res.status(404).json({ message: 'Your student profile could not be found.' });
    res.json(student);
  } catch (error) {
    next(error);
  }
});

app.get('/api/students/departments', requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await Student.distinct('department'));
  } catch (error) {
    next(error);
  }
});

app.put('/api/student/project', requireRole('student'), async (req, res, next) => {
  try {
    const student = await Student.findOne({ userId: req.user._id });
    if (!student) return res.status(404).json({ message: 'Your student profile could not be found.' });
    student.websiteTitle = String(req.body.title || '').trim().slice(0, 160);
    student.websiteDescription = String(req.body.description || '').trim().slice(0, 3000);
    if (req.body.semester) student.semester = String(req.body.semester).trim();
    await student.save();
    res.json({ message: 'Project details updated.', student });
  } catch (error) {
    next(error);
  }
});

app.get('/api/students', requireRole('admin'), async (req, res, next) => {
  try {
    const students = await Student.find({}).sort({ department: 1, rollNumber: 1 }).populate('userId', 'isEnabled isApproved').lean();
    res.json(students.map(student => ({
      ...student,
      accountEnabled: student.userId ? student.userId.isEnabled : null,
      accountApproved: student.userId ? student.userId.isApproved : null,
      userId: student.userId?._id || null
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/showcase/projects', requireRole('student'), async (req, res, next) => {
  try {
    const projects = await Student.find({ websiteSubmitted: true })
      .select('name department websiteTitle websiteDescription websitePath files')
      .lean();
    res.json(projects.map(student => ({
      projectId: String(student._id),
      title: student.websiteTitle || 'Student project',
      description: student.websiteDescription || '',
      studentName: student.name,
      department: student.department,
      websiteUrl: student.websitePath ? `/api/showcase/sites/${student._id}` : null,
      files: (student.files || []).filter(file => file.fileId).map(file => ({
        filename: file.filename,
        contentType: file.contentType || 'application/octet-stream',
        previewUrl: `/api/showcase/files/${file.fileId}`
      }))
    })));
  } catch (error) {
    next(error);
  }
});

async function streamShowcaseSite(req, res, next, studentId, requestedPath) {
  try {
    if (!ObjectId.isValid(studentId)) return res.status(400).send('Invalid project identifier.');
    const student = await Student.findById(studentId).select('websiteSubmitted websitePath files').lean();
    if (!student || !student.websiteSubmitted) return res.status(404).send('Submitted project not found.');

    const files = student.files || [];
    let relativePath = requestedPath ? safeRelativePath(requestedPath) : '';
    if (!relativePath) relativePath = projectEntryPath(student);

    if (relativePath) {
      const storedFile = files.find(file => safeRelativePath(file.filename) === relativePath && file.fileId);
      if (storedFile) {
        return await sendShowcaseFile(
          res,
          bucket.openDownloadStream(new ObjectId(storedFile.fileId)),
          studentId,
          relativePath,
          storedFile.contentType || getMime(relativePath)
        );
      }
    }

    if (!student.websitePath || !student.websitePath.startsWith('submissions/')) {
      return res.status(404).send('Website file not found.');
    }
    const websiteSegments = safeRelativePath(student.websitePath).split('/');
    if (websiteSegments[0] !== 'submissions' || websiteSegments.length < 3) {
      return res.status(404).send('Website file not found.');
    }
    const projectSegments = websiteSegments.slice(1, -1);
    const fileSegments = relativePath
      ? relativePath.split('/')
      : websiteSegments.slice(2);
    const submissionsRoot = path.resolve(distPath, 'submissions');
    const physicalPath = path.resolve(submissionsRoot, ...projectSegments, ...fileSegments);
    if (!physicalPath.startsWith(`${submissionsRoot}${path.sep}`)) {
      return res.status(400).send('Invalid website file path.');
    }
    const stat = await fsPromises.stat(physicalPath).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (!stat?.isFile()) return res.status(404).send('Website file not found.');
    return await sendShowcaseFile(
      res,
      fs.createReadStream(physicalPath),
      studentId,
      relativePath || fileSegments.join('/'),
      getMime(physicalPath)
    );
  } catch (error) {
    if (error.message === 'Invalid project file path.') return res.status(400).send('Invalid website file path.');
    next(error);
  }
}

app.get('/api/showcase/sites/:studentId', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.studentId)) return res.status(400).send('Invalid project identifier.');
    const student = await Student.findById(req.params.studentId).select('websiteSubmitted websitePath files').lean();
    if (!student || !student.websiteSubmitted) return res.status(404).send('Submitted project not found.');

    const entryPath = projectEntryPath(student);
    if (entryPath) {
      const encodedPath = entryPath.split('/').map(encodeURIComponent).join('/');
      return res.redirect(302, `/api/showcase/sites/${req.params.studentId}/${encodedPath}`);
    }
    return streamShowcaseSite(req, res, next, req.params.studentId, '');
  } catch (error) {
    next(error);
  }
});

app.get(/^\/api\/showcase\/sites\/([a-f\d]{24})\/(.+)$/i, (req, res, next) =>
  streamShowcaseSite(req, res, next, req.params[0], req.params[1])
);

app.get('/api/students/:rollNumber', async (req, res, next) => {
  try {
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (req.user.role !== 'admin' && (!student.userId || !student.userId.equals(req.user._id))) {
      return res.status(403).json({ message: 'You may only access your own student profile.' });
    }
    res.json(student);
  } catch (error) {
    next(error);
  }
});

app.post('/api/students', requireRole('admin'), async (req, res) => {
  let user;
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const rollNumber = normalizeRoll(req.body.rollNumber);
    const department = String(req.body.department || '').trim();
    if (!name || !rollNumber || !department || !email || !validatePassword(password)) {
      return res.status(400).json({ message: 'Name, roll number, department, email, and an 8–128 character password are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists.' });
    if (await Student.exists({ rollNumber, department })) {
      return res.status(409).json({ message: `Roll number ${rollNumber} already exists in ${department}.` });
    }
    user = await User.create({
      name, email, password, role: 'student', rollNumber, department,
      isApproved: true, isEnabled: true
    });
    const student = await Student.create({
      ...req.body,
      userId: user._id,
      name,
      email,
      rollNumber,
      department,
      profileImage: req.body.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1d4ed8&color=fff`
    });
    return res.status(201).json(student);
  } catch (error) {
    if (user) await User.findByIdAndDelete(user._id);
    if (error.code === 11000) return res.status(409).json({ message: 'An account or student profile with these details already exists.' });
    console.error('Admin student creation error:', error);
    return res.status(500).json({ message: 'Could not create the student account.' });
  }
});

app.put('/api/students/:rollNumber', requireRole('admin'), async (req, res, next) => {
  try {
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const nextDepartment = String(req.body.department || student.department);
    const nextRoll = normalizeRoll(req.body.rollNumber || student.rollNumber);
    if (nextDepartment !== student.department || nextRoll !== student.rollNumber) {
      const conflict = await Student.findOne({
        rollNumber: nextRoll,
        department: nextDepartment,
        _id: { $ne: student._id }
      });
      if (conflict) return res.status(409).json({ message: `Roll number ${nextRoll} already exists in ${nextDepartment}.` });
    }
    const password = String(req.body.password || '');
    if (password && !validatePassword(password)) {
      return res.status(400).json({ message: 'Password must be between 8 and 128 characters.' });
    }
    if (req.body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(req.body.email).trim())) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    const linkedUser = student.userId ? await User.findById(student.userId) : null;
    if (linkedUser && req.body.email) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!linkedUser.loginId && await User.exists({ email, _id: { $ne: linkedUser._id } })) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
    }
    if (!linkedUser && req.body.email && !password) {
      return res.status(400).json({ message: 'Set a password when creating an account for this student.' });
    }
    if (!linkedUser && req.body.email && await User.exists({ email: String(req.body.email).trim().toLowerCase() })) {
      const matchingUser = await User.findOne({ email: String(req.body.email).trim().toLowerCase() });
      if (matchingUser?.role !== 'student'
        || normalizeRoll(matchingUser.rollNumber) !== student.rollNumber
        || matchingUser.department !== student.department) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
    }
    const updates = { ...req.body };
    delete updates.password;
    delete updates.role;
    delete updates.userId;
    delete updates.files;
    delete updates.websitePath;
    updates.rollNumber = nextRoll;
    updates.department = nextDepartment;
    const updated = await Student.findByIdAndUpdate(student._id, { $set: updates }, { new: true, runValidators: true });
    if (linkedUser) {
      linkedUser.name = updated.name;
      if (!linkedUser.loginId) linkedUser.email = updated.email;
      linkedUser.rollNumber = updated.rollNumber;
      linkedUser.department = updated.department;
      if (password) linkedUser.password = password;
      await linkedUser.save();
    } else if (updated.email && password) {
      let newUser = await User.findOne({ email: updated.email.toLowerCase() });
      if (!newUser) {
        newUser = await User.create({
          name: updated.name,
          email: updated.email.toLowerCase(),
          password,
          role: 'student',
          rollNumber: updated.rollNumber,
          department: updated.department,
          isApproved: true,
          isEnabled: true
        });
      } else {
        newUser.name = updated.name;
        newUser.rollNumber = updated.rollNumber;
        newUser.department = updated.department;
        newUser.password = password;
        newUser.isEnabled = true;
        newUser.isApproved = true;
        await newUser.save();
      }
      updated.userId = newUser._id;
      await updated.save();
    }
    res.json(updated);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'The student roll number or account email is already in use.' });
    next(error);
  }
});

app.patch('/api/students/:rollNumber/account', requireRole('admin'), async (req, res, next) => {
  try {
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!student.userId) return res.status(409).json({ message: 'This student has no linked account.' });
    const user = await User.findById(student.userId);
    if (!user) return res.status(404).json({ message: 'Student account not found.' });
    if (typeof req.body.isEnabled === 'boolean') user.isEnabled = req.body.isEnabled;
    if (typeof req.body.isApproved === 'boolean') user.isApproved = req.body.isApproved;
    await user.save();
    res.json(publicUser(user));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/students/:rollNumber/account/password', requireRole('admin'), async (req, res, next) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ message: 'A student password must be between 10 and 128 characters long.' });
    }
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!student.userId) return res.status(409).json({ message: 'This student has no linked account.' });
    const user = await User.findById(student.userId);
    if (!user) return res.status(404).json({ message: 'Student account not found.' });
    user.password = password;
    await user.save();
    res.json({ message: 'Student password reset successfully.' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/students/:rollNumber', requireRole('admin'), async (req, res, next) => {
  try {
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    await deleteStudentFiles(student);
    if (student.userId) await User.findByIdAndDelete(student.userId);
    await Student.findByIdAndDelete(student._id);
    res.json({ message: 'Student and linked account deleted.' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/students/:rollNumber/project', requireRole('admin'), async (req, res, next) => {
  try {
    const rollNumber = normalizeRoll(req.params.rollNumber);
    const { student, ambiguous } = await findStudentByIdentity(rollNumber, req.query.department);
    if (ambiguous) return res.status(400).json({ message: 'Department is required when a roll number exists in multiple departments.' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    await deleteStudentFiles(student);
    student.files = [];
    student.websiteSubmitted = false;
    student.websiteTitle = '';
    student.websiteDescription = '';
    student.websitePath = '';
    student.submissionDate = null;
    await student.save();
    res.json({ message: 'Project and uploaded files deleted.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/assignments/self-submit', requireRole('student'), upload.any(), async (req, res, next) => {
  const storedIds = [];
  try {
    const student = await Student.findOne({ userId: req.user._id });
    if (!student) return res.status(404).json({ message: 'Your student profile could not be found.' });
    if (!req.files?.length) return res.status(400).json({ message: 'Please select at least one project file.' });

    const rollNumber = student.rollNumber;
    const department = student.department;
    const folderKey = `${department.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${rollNumber}`;
    const uploadedFiles = [];
    const firstFile = req.files[0];
    const isZip = req.files.length === 1
      && (firstFile.mimetype.includes('zip') || firstFile.originalname.toLowerCase().endsWith('.zip'));

    const storeFile = async (buffer, relPath, sourcePath, fromZip = false) => {
      const safePath = safeRelativePath(relPath);
      const gridFilename = `${folderKey}/${safePath}`;
      const contentType = getMime(safePath);
      const saved = await streamBufferToGridFS(buffer, gridFilename, contentType, {
        rollNumber,
        department,
        studentId: student._id,
        userId: req.user._id,
        originalPath: sourcePath || safePath,
        uploadedAt: new Date(),
        fromZip
      });
      storedIds.push(saved._id);
      uploadedFiles.push({
        filename: safePath,
        fileId: saved._id,
        contentType,
        uploadDate: new Date()
      });
      return safePath;
    };

    let entryHtml = null;
    if (isZip) {
      const zip = new AdmZip(firstFile.buffer);
      const entries = zip.getEntries().filter(entry => !entry.isDirectory);
      if (!entries.length) return res.status(400).json({ message: 'The selected ZIP contains no files.' });
      if (entries.length > MAX_ARCHIVE_FILES) {
        return res.status(413).json({ message: `A ZIP may contain at most ${MAX_ARCHIVE_FILES} files.` });
      }
      for (const entry of entries) {
        const relPath = safeRelativePath(entry.entryName);
        if (entry.header.size > MAX_FILE_SIZE) {
          const sizeError = new Error(`Each file inside a ZIP must be no larger than ${MAX_FILE_SIZE / (1024 * 1024)} MB.`);
          sizeError.statusCode = 413;
          throw sizeError;
        }
        await storeFile(entry.getData(), relPath, relPath, true);
        const basename = path.posix.basename(relPath).toLowerCase();
        if (relPath.toLowerCase().endsWith('.html') && (!entryHtml || basename === 'index.html' || basename.includes('index'))) {
          entryHtml = relPath;
        }
      }
    } else {
      const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.paths || ''];
      for (let index = 0; index < req.files.length; index += 1) {
        const file = req.files[index];
        const relative = paths[index] || file.originalname;
        const parts = String(relative).replace(/\\/g, '/').split('/');
        const relPath = parts.length > 1 ? parts.slice(1).join('/') : relative;
        const savedPath = await storeFile(file.buffer, relPath, file.originalname);
        const basename = path.posix.basename(savedPath).toLowerCase();
        if (savedPath.toLowerCase().endsWith('.html') && (!entryHtml || basename === 'index.html' || basename.includes('index'))) {
          entryHtml = savedPath;
        }
      }
    }

    student.files.push(...uploadedFiles);
    student.websiteSubmitted = true;
    student.submissionDate = new Date();
    if (req.body.title) student.websiteTitle = String(req.body.title).trim().slice(0, 160);
    if (req.body.description) student.websiteDescription = String(req.body.description).trim().slice(0, 3000);
    if (req.body.semester) student.semester = String(req.body.semester).trim();
    student.websitePath = entryHtml
      ? `submissions/${folderKey}/${entryHtml}`
      : `submissions/${folderKey}/${uploadedFiles[0].filename}`;
    await student.save();

    res.json({
      success: true,
      message: `Project submitted successfully. Stored ${uploadedFiles.length} file(s).`,
      rollNumber,
      department,
      filesCount: uploadedFiles.length
    });
  } catch (error) {
    for (const id of storedIds) {
      try {
        await bucket.delete(id);
      } catch (cleanupError) {
        console.error('Could not remove incomplete project upload:', cleanupError);
      }
    }
    next(error);
  }
});

app.get('/api/assignments/file/:fileId', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.fileId)) return res.status(400).json({ message: 'Invalid file identifier.' });
    const fileId = new ObjectId(req.params.fileId);
    const file = await bucket.find({ _id: fileId }).next();
    if (!file) return res.status(404).json({ message: 'File not found.' });
    const student = file.metadata?.studentId
      ? await Student.findById(file.metadata.studentId)
      : file.metadata?.rollNumber && file.metadata?.department
        ? await Student.findOne({ rollNumber: file.metadata.rollNumber, department: file.metadata.department })
        : null;
    if (!student) return res.status(404).json({ message: 'The file owner could not be found.' });
    if (req.user.role !== 'admin' && (!student.userId || !student.userId.equals(req.user._id))) {
      return res.status(403).json({ message: 'You may only access your own project files.' });
    }
    setProjectResponseHeaders(res, file.contentType, file.filename);
    bucket.openDownloadStream(fileId).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get('/api/showcase/files/:fileId', requireRole('student'), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.fileId)) return res.status(400).json({ message: 'Invalid file identifier.' });
    const fileId = new ObjectId(req.params.fileId);
    const student = await Student.findOne({
      websiteSubmitted: true,
      'files.fileId': fileId
    });
    if (!student) return res.status(404).json({ message: 'Showcase file not found.' });
    const file = student.files.find(entry => entry.fileId && entry.fileId.equals(fileId));
    if (!file) return res.status(404).json({ message: 'Showcase file not found.' });
    setProjectResponseHeaders(res, file.contentType, file.filename);
    bucket.openDownloadStream(fileId).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get(/^\/submissions\/(.+)$/, async (req, res, next) => {
  try {
    const relativePath = safeRelativePath(decodeURIComponent(req.params[0]));
    const file = await bucket.find({ filename: relativePath }).next();
    if (!file) return res.status(404).send('Project file not found.');
    const student = file.metadata?.studentId
      ? await Student.findById(file.metadata.studentId)
      : file.metadata?.rollNumber && file.metadata?.department
        ? await Student.findOne({ rollNumber: file.metadata.rollNumber, department: file.metadata.department })
        : null;
    if (!student) return res.status(404).send('Project owner not found.');
    if (req.user.role !== 'admin' && (!student.userId || !student.userId.equals(req.user._id))) {
      return res.status(403).send('You may only access your own project files.');
    }
    setProjectResponseHeaders(res, file.contentType, file.filename);
    bucket.openDownloadStream(file._id).on('error', next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get('/admin.html', requireAuth, requireRole('admin'), (req, res) => res.sendFile(path.join(distPath, 'admin.html')));
app.get('/students.html', requireAuth, requireRole('admin'), (req, res) => res.sendFile(path.join(distPath, 'students.html')));
app.get('/profile.html', requireAuth, (req, res) => res.sendFile(path.join(distPath, 'profile.html')));
app.get('/dashboard.html', requireAuth, requireRole('student'), (req, res) => res.sendFile(path.join(distPath, 'dashboard.html')));
app.get('/upload.html', requireAuth, requireRole('student'), (req, res) => res.sendFile(path.join(distPath, 'upload.html')));
app.get('/showcase.html', requireAuth, requireRole('student'), (req, res) => res.sendFile(path.join(distPath, 'showcase.html')));
app.get('/index.html', requireAuth, (req, res) => res.redirect(req.user.role === 'admin' ? '/admin.html' : '/dashboard.html'));
app.get(/^\/.*\.html$/, requireAuth, (req, res) => res.status(404).send('Page not found.'));

app.use((req, res) => res.status(404).send('Not found.'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Each file must be no larger than ${MAX_FILE_SIZE / (1024 * 1024)} MB.` });
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ message: `You can upload at most ${MAX_UPLOAD_FILES} files at a time.` });
    return res.status(400).json({ message: error.message });
  }
  console.error('Request failed:', error);
  return res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : 'The request could not be completed.'
  });
});

async function startServer() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/college_portal');
  await User.init();
  await ensureStudentIndexes();
  bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'assignments' });
  await bootstrapAdmin();
  await linkLegacyStudentAccounts();
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
