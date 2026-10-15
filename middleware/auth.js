const jwt = require('jsonwebtoken');
const User = require('../models/User');

function readToken(req) {
  const authorization = req.get('Authorization');
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  const cookieHeader = req.get('Cookie') || '';
  const tokenCookie = cookieHeader.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith('st_showcase_token='));
  return tokenCookie ? tokenCookie.slice('st_showcase_token='.length) : '';
}

async function getRequestUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  if (!user || !user.isEnabled || (user.role === 'student' && !user.isApproved)) return null;
  return user;
}

async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) {
    if (req.method === 'GET' && req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
      return res.redirect('/login.html');
    }
    return res.status(401).json({ message: 'Authentication is required.' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'Authentication is unavailable because JWT_SECRET is not configured.' });
    }
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id);
    if (!user || !user.isEnabled) {
      res.clearCookie('st_showcase_token', { path: '/' });
      return res.status(401).json({ message: 'This account is unavailable.' });
    }
    if (user.role === 'student' && !user.isApproved) {
      res.clearCookie('st_showcase_token', { path: '/' });
      return res.status(403).json({ message: 'Your account is awaiting administrator approval.' });
    }

    req.user = user;
    res.set('Cache-Control', 'no-store');
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      res.clearCookie('st_showcase_token', { path: '/' });
      if (req.method === 'GET' && req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
        return res.redirect('/login.html');
      }
      return res.status(401).json({ message: 'Your session is invalid or has expired.' });
    }
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      if (req.method === 'GET' && req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
        return res.status(403).type('text').send('You do not have permission to access this page.');
      }
      return res.status(403).json({ message: 'You do not have permission to access this resource.' });
    }
    next();
  };
}

module.exports = { getRequestUser, requireAuth, requireRole };
