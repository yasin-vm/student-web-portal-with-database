process.env.JWT_SECRET = 'automated-test-secret-which-is-not-used-outside-this-test';
process.env.NODE_ENV = 'production';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('node:path');
const User = require('../models/User');
const Student = require('../models/Student');
const { app } = require('../server');

const objectId = () => new mongoose.Types.ObjectId();
const admin = makeUser({ name: 'Test Admin', email: 'admin-test@example.invalid', role: 'admin' });
const studentUser = makeUser({
  name: 'Test Student',
  email: 'student-test@example.invalid',
  role: 'student',
  rollNumber: '01',
  department: 'Computer Science',
  isApproved: true
});
const otherStudent = makeUser({
  name: 'Other Student',
  email: 'other-test@example.invalid',
  role: 'student',
  rollNumber: '02',
  department: 'Computer Science',
  isApproved: true
});
const pendingStudent = makeUser({
  name: 'Pending Student',
  email: 'pending-student-test@example.invalid',
  role: 'student',
  rollNumber: '03',
  department: 'Mechanical',
  isApproved: false
});
let showcaseWebsitePath = 'submissions/01/index.html';
const users = new Map([admin, studentUser, otherStudent, pendingStudent].map(user => [user._id.toString(), user]));
const studentRecord = {
  _id: objectId(),
  userId: studentUser._id,
  rollNumber: '01',
  department: 'Computer Science',
  name: 'Test Student',
  semester: 'S7',
  files: []
};
Student.findById = id => {
  const record = studentRecords.find(student => student._id.toString() === String(id));
  if (!record) return null;
  const project = {
    ...record,
    websiteSubmitted: true,
    websitePath: showcaseWebsitePath,
    files: []
  };
  return {
    select() { return this; },
    lean: async () => project
  };
};
const otherRecord = {
  _id: objectId(),
  userId: otherStudent._id,
  rollNumber: '02',
  department: 'Computer Science',
  name: 'Other Student',
  semester: 'S7',
  files: []
};
const pendingRecord = {
  _id: objectId(),
  userId: pendingStudent._id,
  rollNumber: '03',
  department: 'Mechanical',
  name: 'Pending Student',
  semester: 'S1',
  websiteSubmitted: false,
  files: []
};
const studentRecords = [studentRecord, otherRecord, pendingRecord];
let createdSlot;
let server;
let baseUrl;
let showcaseFixturePath;

function makeUser(values) {
  return {
    _id: objectId(),
    isEnabled: true,
    isApproved: true,
    password: 'test-password-123',
    passwordHashed: false,
    saveCalls: 0,
    ...values,
    async comparePassword(password) {
      return this.passwordHashed
        ? bcrypt.compare(password, this.password)
        : password === 'test-password-123';
    },
    async save() {
      this.password = await bcrypt.hash(this.password, 4);
      this.passwordHashed = true;
      this.saveCalls += 1;
    }
  };
}

User.findOne = async ({ email, loginId }) => [...users.values()].find(user =>
  (email && user.email === email) || (loginId && user.loginId === loginId)
) || null;
User.findById = async id => users.get(String(id)) || null;
User.exists = async ({ email, role, _id }) => [...users.values()].some(user =>
  (!email || user.email === email)
  && (!role || user.role === role)
  && (!_id?.$ne || user._id.toString() !== String(_id.$ne))
) ? { _id: objectId() } : null;
User.create = async values => {
  const user = makeUser(values);
  users.set(user._id.toString(), user);
  return user;
};
Student.exists = async ({ userId }) => userId && studentRecords.some(student => student.userId.equals(userId))
  ? { _id: studentRecord._id }
  : null;
Student.findOne = query => {
  if (query.userId) {
    const student = studentRecords.find(record => record.userId.equals(query.userId)) || null;
    return {
      lean: async () => student,
      then: (resolve, reject) => Promise.resolve(student).then(resolve, reject)
    };
  }
  return Promise.resolve(studentRecords.find(student =>
    student.rollNumber === query.rollNumber && student.department === query.department
  ) || null);
};
const showcaseFileId = objectId();
const showcaseRecord = {
  ...studentRecord,
  websitePath: 'submissions/01/index.html',
  websiteSubmitted: true,
  websiteTitle: 'Secure Sensors',
  websiteDescription: 'A student project description.',
  email: 'private-student@example.invalid',
  phone: 'private-phone',
  cgpa: 'private-cgpa',
  files: [{
    filename: 'index.html',
    fileId: showcaseFileId,
    contentType: 'text/html'
  }]
};
Student.find = query => {
  const rows = query.websiteSubmitted
    ? [showcaseRecord, {
      ...otherRecord,
      websiteSubmitted: true,
      websiteTitle: 'Other project',
      websiteDescription: 'Another description.',
      email: 'other-private@example.invalid',
      phone: 'other-private-phone',
      cgpa: 'other-private-cgpa',
      files: []
    }]
    : studentRecords.map(student => ({
      ...student,
      userId: {
        _id: student.userId,
        isEnabled: users.get(student.userId.toString()).isEnabled,
        isApproved: users.get(student.userId.toString()).isApproved
      }
    }));
  return {
    select() { return this; },
    sort() { return this; },
    populate() { return this; },
    lean: async () => rows
  };
};
Student.distinct = async field => [...new Set(studentRecords.map(student => student[field]).filter(Boolean))];
Student.create = async values => {
  createdSlot = { ...values, _id: objectId() };
  return createdSlot;
};

test.before(async () => {
  const submissionsPath = path.join(__dirname, '..', 'student-web-portal-main', 'dist', 'submissions');
  await fs.mkdir(submissionsPath, { recursive: true });
  showcaseFixturePath = await fs.mkdtemp(path.join(submissionsPath, 'showcase-test-'));
  await fs.mkdir(path.join(showcaseFixturePath, 'css'), { recursive: true });
  await fs.mkdir(path.join(showcaseFixturePath, 'js'), { recursive: true });
  await fs.writeFile(path.join(showcaseFixturePath, 'index.html'), [
    '<!doctype html>',
    '<html><head><link rel="stylesheet" href="css/styles.css">',
    '<script src="js/main.js"></script></head>',
    '<body><h1>Test showcase project</h1></body></html>'
  ].join(''));
  await fs.writeFile(path.join(showcaseFixturePath, 'css', 'styles.css'), 'body { --ink: #17212b; }');
  await fs.writeFile(path.join(showcaseFixturePath, 'js', 'main.js'), "const status = 'Profile checked for';");
  showcaseWebsitePath = `submissions/${path.basename(showcaseFixturePath)}/index.html`;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.rm(showcaseFixturePath, { recursive: true, force: true });
});

test('root is login-first and unauthenticated API access is rejected', async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), { status: 'unavailable' });

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-page="login"/);
  const protectedPages = ['/admin.html', '/students.html', '/profile.html', '/dashboard.html', '/upload.html', '/showcase.html'];
  for (const route of protectedPages) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual' });
    assert.equal(response.status, 302, `${route} should redirect to login when logged out`);
    assert.equal(response.headers.get('location'), '/login.html');
  }
  const protectedApis = ['/api/students', '/api/student/me', '/api/showcase/projects', '/api/auth/me'];
  for (const route of protectedApis) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 401, `${route} should return 401 when logged out`);
  }
  assert.equal((await fetch(`${baseUrl}/api/auth/register`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/assets/portal-app.js`)).status, 200);
});

test('student roll-number uniqueness remains department-scoped', () => {
  const uniqueIndex = Student.schema.indexes().find(([fields, options]) =>
    fields.department === 1 && fields.rollNumber === 1 && options.unique === true
  );
  assert.ok(uniqueIndex, 'Student schema must enforce unique department + roll number pairs.');
});

async function signIn(email, password = 'test-password-123') {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return {
    response,
    cookie: response.headers.get('set-cookie')?.split(';', 1)[0]
  };
}

test('admin can sign in and open the protected management page', async () => {
  const { response, cookie } = await signIn(admin.email);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.match(response.headers.get('set-cookie'), /Secure/i);
  const page = await fetch(`${baseUrl}/admin.html`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Student Management/);
});

test('student can sign in but is blocked from the admin page', async () => {
  const { response, cookie } = await signIn(studentUser.email);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).redirectTo, '/dashboard.html');
  const dashboard = await fetch(`${baseUrl}/dashboard.html`, { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  const ownProfile = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(ownProfile.status, 200);
  assert.equal((await ownProfile.json()).student._id, studentRecord._id.toString());
  const page = await fetch(`${baseUrl}/admin.html`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 403);
});

test('student can sign in with the provisioned login ID', async () => {
  const loginId = 'teststudent01@gmail.com';
  studentUser.loginId = loginId;
  const { response } = await signIn(loginId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).redirectTo, '/dashboard.html');
});

test('student receives 403 when reading another student profile', async () => {
  const { cookie } = await signIn(studentUser.email);
  const response = await fetch(`${baseUrl}/api/students/02?department=Computer%20Science`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 403);
});

test('students cannot edit or delete another student project', async () => {
  const { cookie } = await signIn(studentUser.email);
  const edit = await fetch(`${baseUrl}/api/students/02?department=Computer%20Science`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ websiteTitle: 'Unauthorized edit' })
  });
  assert.equal(edit.status, 403);
  const remove = await fetch(`${baseUrl}/api/students/02/project?department=Computer%20Science`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
  assert.equal(remove.status, 403);
});

test('admin can list students and approve a pending account', async () => {
  const { cookie } = await signIn(admin.email);
  const list = await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  const records = await list.json();
  assert.ok(records.some(record => record.accountApproved === false && record.department === 'Mechanical'));

  const approve = await fetch(`${baseUrl}/api/students/03/account?department=Mechanical`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isApproved: true })
  });
  assert.equal(approve.status, 200);
  assert.equal(pendingStudent.isApproved, true);
});

test('admin department options reflect departments present in student records', async () => {
  const { cookie } = await signIn(admin.email);
  const response = await fetch(`${baseUrl}/api/students/departments`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sort(), ['Computer Science', 'Mechanical']);
});

test('student Showcase returns only submitted project fields and safe file previews', async () => {
  const { cookie } = await signIn(studentUser.email);
  const response = await fetch(`${baseUrl}/api/showcase/projects`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200);
  const projects = await response.json();
  assert.equal(projects.length, 2);
  assert.deepEqual(Object.keys(projects[0]).sort(), ['department', 'description', 'files', 'projectId', 'studentName', 'title', 'websiteUrl']);
  assert.deepEqual(Object.keys(projects[0].files[0]).sort(), ['contentType', 'filename', 'previewUrl']);
  assert.equal(projects[0].title, 'Secure Sensors');
  assert.equal(projects[0].studentName, 'Test Student');
  assert.equal(projects[0].projectId, studentRecord._id.toString());
  assert.equal(projects[0].websiteUrl, `/api/showcase/sites/${studentRecord._id}`);
  assert.ok(projects.some(project => project.studentName === 'Test Student' && project.projectId === studentRecord._id.toString()));
  assert.equal(projects[0].files[0].previewUrl, `/api/showcase/files/${showcaseFileId}`);
  assert.doesNotMatch(JSON.stringify(projects), /email|phone|cgpa|rollNumber|userId/i);
});

test('students can open another submitted student website through the authenticated showcase route', async () => {
  const { cookie } = await signIn(otherStudent.email);
  const entryResponse = await fetch(`${baseUrl}/api/showcase/sites/${studentRecord._id}`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(entryResponse.status, 302);
  assert.equal(entryResponse.headers.get('location'), `/api/showcase/sites/${studentRecord._id}/index.html`);

  const response = await fetch(`${baseUrl}/api/showcase/sites/${studentRecord._id}`, {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /Test showcase project/);
  assert.match(html, new RegExp(`/api/showcase/sites/${studentRecord._id}/css/styles\\.css\\?access=`));

  const noTokenAsset = await fetch(`${baseUrl}/api/showcase/sites/${studentRecord._id}/index.html`);
  assert.equal(noTokenAsset.status, 401);

  const ownProjectResponse = await fetch(`${baseUrl}/api/showcase/sites/${studentRecord._id}`, {
    headers: { Cookie: cookie }
  });
  assert.equal(ownProjectResponse.status, 200);
  const ownProjectHtml = await ownProjectResponse.text();
  const cssUrl = ownProjectHtml.match(/href="([^"]*css\/styles\.css\?access=[^"]*)"/)?.[1];
  const scriptUrl = ownProjectHtml.match(/src="([^"]*js\/main\.js\?access=[^"]*)"/)?.[1];
  assert.ok(cssUrl, 'Project stylesheet URL should include a scoped access token.');
  assert.ok(scriptUrl, 'Project script URL should include a scoped access token.');

  const cssResponse = await fetch(new URL(cssUrl, baseUrl));
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get('content-type'), /text\/css/);
  assert.match(await cssResponse.text(), /--ink/);

  const scriptResponse = await fetch(new URL(scriptUrl, baseUrl));
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get('content-type'), /javascript/);
  assert.match(await scriptResponse.text(), /Profile checked for/);

  const adminSession = await signIn(admin.email);
  const adminResponse = await fetch(`${baseUrl}/api/showcase/sites/${studentRecord._id}`, {
    headers: { Cookie: adminSession.cookie }
  });
  assert.equal(adminResponse.status, 200);
});

test('admin account settings require current password and keep the cookie session valid', async () => {
  const { cookie } = await signIn(admin.email);
  const invalidCurrent = await fetch(`${baseUrl}/api/admin/account-settings`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'incorrect-password', email: 'new-admin@example.invalid' })
  });
  assert.equal(invalidCurrent.status, 401);

  const shortPassword = await fetch(`${baseUrl}/api/admin/account-settings`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' })
  });
  assert.equal(shortPassword.status, 400);

  const update = await fetch(`${baseUrl}/api/admin/account-settings`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: 'test-password-123',
      email: ' UPDATED-ADMIN@example.invalid ',
      newPassword: 'new-admin-password-123'
    })
  });
  assert.equal(update.status, 200);
  const result = await update.json();
  assert.equal(result.user.email, 'updated-admin@example.invalid');
  assert.equal(Object.hasOwn(result.user, 'password'), false);
  assert.equal(await bcrypt.compare('new-admin-password-123', admin.password), true);
  assert.equal(await admin.comparePassword('new-admin-password-123'), true);

  const sameSession = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(sameSession.status, 200);
  assert.equal((await sameSession.json()).user.email, 'updated-admin@example.invalid');
});

test('students can change their own password only after verifying their current password', async () => {
  const { cookie } = await signIn(studentUser.email, 'test-password-123');
  const endpoint = `${baseUrl}/api/student/account/password`;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const { cookie: adminCookie } = await signIn(admin.email, 'new-admin-password-123');
  const adminAttempt = await fetch(endpoint, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'new-admin-password-123', newPassword: 'admin-changed-password-123' })
  });
  assert.equal(adminAttempt.status, 403);

  const wrongCurrentPassword = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ currentPassword: 'incorrect-password', newPassword: 'student-changed-password-123' })
  });
  assert.equal(wrongCurrentPassword.status, 401);

  const shortPassword = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'short' })
  });
  assert.equal(shortPassword.status, 400);

  const changed = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ currentPassword: 'test-password-123', newPassword: 'student-changed-password-123' })
  });
  assert.equal(changed.status, 200);
  assert.equal(await studentUser.comparePassword('student-changed-password-123'), true);
  assert.equal((await signIn(studentUser.email, 'student-changed-password-123')).response.status, 200);
});

test('admin can reset a student password with a minimum of ten characters', async () => {
  const { cookie } = await signIn(admin.email, 'new-admin-password-123');
  const shortPassword = await fetch(`${baseUrl}/api/students/01/account/password?department=Computer%20Science`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'short' })
  });
  assert.equal(shortPassword.status, 400);

  const reset = await fetch(`${baseUrl}/api/students/01/account/password?department=Computer%20Science`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'student-new-password-123' })
  });
  assert.equal(reset.status, 200);
  assert.equal(await bcrypt.compare('student-new-password-123', studentUser.password), true);
  assert.equal(await studentUser.comparePassword('student-new-password-123'), true);
});

test('self-registration creates a department-scoped student slot awaiting approval', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'New Test Student',
      email: 'new-student-test@example.invalid',
      password: 'test-password-123',
      rollNumber: '07',
      department: 'Mechanical'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.match(result.message, /administrator must approve/i);
  assert.equal(createdSlot.rollNumber, '07');
  assert.equal(createdSlot.department, 'Mechanical');
  assert.equal(createdSlot.userId.toString(), [...users.values()].find(user => user.email === 'new-student-test@example.invalid')._id.toString());
  const login = await signIn('new-student-test@example.invalid');
  assert.equal(login.response.status, 403);
  assert.match((await login.response.json()).message, /awaiting administrator approval/i);
});

test('student uploads are capped at ten files', async () => {
  const { cookie } = await signIn(studentUser.email, 'student-new-password-123');
  const form = new FormData();
  for (let index = 0; index < 11; index += 1) {
    form.append('assignmentFiles', new Blob(['x']), `file-${index}.txt`);
  }
  const response = await fetch(`${baseUrl}/api/assignments/self-submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });

  assert.equal(response.status, 413);
});

test('student uploads are capped at ten megabytes per file', async () => {
  const { cookie } = await signIn(studentUser.email, 'student-new-password-123');
  const form = new FormData();
  form.append('assignmentFile', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'large.txt');
  const response = await fetch(`${baseUrl}/api/assignments/self-submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });
  assert.equal(response.status, 413);
});
