const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  loginId: {
    type: String,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'student'],
    default: 'student'
  },
  isApproved: {
    type: Boolean,
    default: true
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  rollNumber: {
    type: String,
    trim: true
  },
  department: {
    type: String,
    enum: ['Computer Science', 'Data Science', 'Electronics & Communication', 'Mechanical', 'Civil'],
    default: 'Computer Science'
  }
}, {
  timestamps: true
});

UserSchema.index({ loginId: 1 }, { unique: true, sparse: true });

UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
