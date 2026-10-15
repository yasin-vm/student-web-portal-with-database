const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rollNumber: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: String,
    required: true,
    enum: ['Computer Science', 'Data Science', 'Electronics & Communication', 'Mechanical', 'Civil'],
    default: 'Computer Science'
  },
  semester: {
    type: String,
    default: 'S7'
  },
  email: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  cgpa: {
    type: String,
    default: ''
  },
  bloodGroup: {
    type: String,
    default: ''
  },
  profileImage: {
    type: String,
    default: ''
  },
  websiteSubmitted: {
    type: Boolean,
    default: false
  },
  websiteTitle: {
    type: String,
    default: ''
  },
  websiteDescription: {
    type: String,
    default: ''
  },
  websitePath: {
    type: String,
    default: ''
  },
  submissionDate: {
    type: Date,
    default: null
  },
  // Store uploaded assignment files referencing GridFS files
  files: [{
    filename: String,
    fileId: mongoose.Schema.Types.ObjectId,
    contentType: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true,
  autoIndex: false
});

StudentSchema.index({ department: 1, rollNumber: 1 }, { unique: true });
StudentSchema.index({ userId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', StudentSchema);
