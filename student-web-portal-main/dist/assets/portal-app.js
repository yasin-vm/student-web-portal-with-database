(() => {
  const api = '/api';
  const page = document.body.dataset.page || '';
  const departmentLabels = {
    'Computer Science': 'Computer Science & Engineering',
    'Data Science': 'Data Science',
    'Electronics & Communication': 'Electronics & Communication Engineering',
    Civil: 'Civil Engineering',
    Mechanical: 'Mechanical Engineering'
  };
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const departmentName = value => departmentLabels[value] || value || 'Engineering';
  const sortStudents = students => [...students].sort((left, right) =>
    departmentName(left.department).localeCompare(departmentName(right.department))
    || String(left.rollNumber || '').localeCompare(String(right.rollNumber || ''), undefined, { numeric: true, sensitivity: 'base' })
    || String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
  );
  const reportValue = value => String(value || '—').replace(/[\r\n\t]+/g, ' ').trim() || '—';
  const downloadTextReport = (title, students) => {
    const sorted = sortStudents(students);
    const submitted = sorted.filter(student => Boolean(student.websiteSubmitted));
    const notSubmitted = sorted.filter(student => !student.websiteSubmitted);
    const lines = [];
    const appendSection = (label, records) => {
      lines.push('', `${label} (${records.length})`);
      records.forEach((student, index) => {
        lines.push(`${index + 1}. ${reportValue(student.name)} (#${reportValue(student.rollNumber)})`);
      });
    };
    appendSection('Submitted', submitted);
    appendSection('Not Submitted', notSubmitted);
    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `st-thomas-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const safeProjectPath = student => {
    return student.websiteSubmitted && student._id
      ? `/api/showcase/sites/${encodeURIComponent(student._id)}`
      : '';
  };
  const message = (element, text, isError = false) => {
    element.textContent = text;
    element.className = `form-status${isError ? ' is-error' : ''}`;
  };
  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || `Request failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  };

  async function renderShell() {
    const header = document.getElementById('site-header');
    const footer = document.getElementById('site-footer');
    if (!header) return null;
    let session;
    try {
      session = await requestJson(`${api}/auth/me`);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.replace('/login.html');
        return null;
      }
      throw error;
    }
    const user = session.user;
    const links = user.role === 'admin'
      ? [['admin', '/admin.html', 'Manage students'], ['students', '/students.html', 'Directory']]
      : [['dashboard', '/dashboard.html', 'My dashboard'], ['showcase', '/showcase.html', 'Showcase'], ['upload', '/upload.html', 'Submit work']];
    header.innerHTML = `
      <nav class="site-nav" aria-label="Main navigation">
        <a class="brand" href="${user.role === 'admin' ? '/admin.html' : '/dashboard.html'}">
          <span class="brand-mark" aria-hidden="true">ST</span>
          <span class="brand-copy">St. Thomas<small>Engineering Showcase</small></span>
        </a>
        <button type="button" class="menu-toggle" aria-label="Open navigation" aria-expanded="false">☰</button>
        <div class="nav-links">
          ${links.map(([key, href, label]) => `<a class="nav-link" href="${href}" ${page === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
          <span class="account-label">${escapeHtml(user.name)} · ${escapeHtml(user.role)}</span>
          <button class="nav-cta nav-signout" type="button" id="signout-button">Log out</button>
        </div>
      </nav>`;
    if (footer) {
      footer.innerHTML = '<div class="footer-inner"><span class="footer-brand">St. Thomas · Engineering Showcase</span><span>Student ideas, shared with the world.</span></div>';
    }
    header.querySelector('.menu-toggle').addEventListener('click', event => {
      const linksContainer = header.querySelector('.nav-links');
      const open = linksContainer.classList.toggle('is-open');
      event.currentTarget.setAttribute('aria-expanded', String(open));
      event.currentTarget.textContent = open ? '×' : '☰';
    });
    header.querySelector('#signout-button').addEventListener('click', async () => {
      try {
        await requestJson(`${api}/auth/logout`, { method: 'POST' });
      } finally {
        window.location.replace('/');
      }
    });
    return session;
  }

  async function setupLogin() {
    const form = document.getElementById('login-form');
    const status = document.getElementById('login-status');
    try {
      const session = await requestJson(`${api}/auth/me`);
      window.location.replace(session.user.role === 'admin' ? '/admin.html' : '/dashboard.html');
      return;
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        message(status, error.message, true);
      }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await requestJson(`${api}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        window.location.replace(result.redirectTo);
      } catch (error) {
        message(status, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  async function setupRegistration() {
    const form = document.getElementById('register-form');
    const select = form.elements.department;
    const status = document.getElementById('account-status');
    try {
      const result = await requestJson(`${api}/auth/register`);
      select.replaceChildren(new Option('Choose department', ''));
      result.departments.sort().forEach(department => select.add(new Option(departmentName(department), department)));
    } catch (error) {
      message(status, `Departments could not be loaded: ${error.message}`, true);
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await requestJson(`${api}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        message(status, result.message);
        form.reset();
      } catch (error) {
        message(status, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  async function setupDashboard(session) {
    const root = document.getElementById('student-dashboard');
    const student = session.student || await requestJson(`${api}/student/me`);
    const path = safeProjectPath(student);
    root.innerHTML = `
      <section class="profile-card dashboard-card">
        <aside class="profile-aside">
          <span class="profile-avatar">${escapeHtml(String(student.name || 'Student').split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase())}</span>
          <p class="eyebrow">Your student profile</p><h1>${escapeHtml(student.name)}</h1>
          <span class="profile-roll">Roll ${escapeHtml(student.rollNumber)}</span>
          <div class="profile-department">${escapeHtml(departmentName(student.department))}</div>
        </aside>
        <div class="profile-details">
          <p class="eyebrow">Your details</p>
          <div class="detail-list">
            <div class="detail-item"><span>Email</span><strong>${escapeHtml(student.email || '—')}</strong></div>
            <div class="detail-item"><span>Semester</span><strong>${escapeHtml(student.semester || '—')}</strong></div>
            <div class="detail-item"><span>Project status</span><strong>${student.websiteSubmitted ? 'Submitted' : 'Not submitted'}</strong></div>
          </div>
          <section class="profile-project">
            <p class="eyebrow">Your project</p>
            <h2>${escapeHtml(student.websiteTitle || (student.websiteSubmitted ? 'Project submitted' : 'No project yet'))}</h2>
            <p>${escapeHtml(student.websiteDescription || 'Add project details and upload your files to share your work.')}</p>
            <div class="hero-actions">
              <a class="button button-dark" href="/upload.html">${student.websiteSubmitted ? 'Update project' : 'Upload a project'} <span aria-hidden="true">↗</span></a>
              ${path ? `<a class="text-link" href="${path}" target="_blank" rel="noopener">Open your website</a>` : ''}
            </div>
          </section>
          <form id="project-details-form" class="project-edit-form">
            <h2>Edit project details</h2>
            <label class="form-field"><span>Project title</span><input name="title" maxlength="160" value="${escapeHtml(student.websiteTitle || '')}"></label>
            <label class="form-field"><span>Description</span><textarea name="description" rows="3" maxlength="3000">${escapeHtml(student.websiteDescription || '')}</textarea></label>
            <label class="form-field"><span>Semester</span><select name="semester">${Array.from({ length: 8 }, (_, index) => `S${index + 1}`).map(semester => `<option ${student.semester === semester ? 'selected' : ''}>${semester}</option>`).join('')}</select></label>
            <button class="button button-dark" type="submit">Save project details</button>
            <p id="project-details-status" class="form-status" aria-live="polite"></p>
          </form>
        </div>
      </section>`;
    const form = document.getElementById('project-details-form');
    const status = document.getElementById('project-details-status');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await requestJson(`${api}/student/project`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        message(status, 'Project details saved.');
      } catch (error) {
        message(status, error.message, true);
      }
    });
  }

  function setupUpload() {
    const form = document.getElementById('upload-form');
    const input = document.getElementById('project-files');
    const status = document.getElementById('upload-status');
    const label = document.getElementById('file-label');
    input.addEventListener('change', () => {
      label.textContent = `${input.files.length} file${input.files.length === 1 ? '' : 's'} selected`;
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!input.files.length) return message(status, 'Choose at least one project file.', true);
      if (input.files.length > 10) return message(status, 'You can upload at most 10 files at a time.', true);
      const files = Array.from(input.files);
      const data = new FormData(form);
      data.delete('project-files');
      files.forEach(file => {
        data.append(files.length === 1 ? 'assignmentFile' : 'assignmentFiles', file);
        if (files.length > 1) data.append('paths', file.webkitRelativePath || file.name);
      });
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await requestJson(`${api}/assignments/self-submit`, { method: 'POST', body: data });
        message(status, `${result.message} You can review it on your dashboard.`);
        input.value = '';
        label.textContent = 'Drop your files here, or browse';
      } catch (error) {
        message(status, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  async function setupAdmin(session) {
    const tbody = document.getElementById('admin-students');
    const form = document.getElementById('student-form');
    const dialog = document.getElementById('student-dialog');
    const passwordDialog = document.getElementById('student-password-dialog');
    const passwordForm = document.getElementById('student-password-form');
    const status = document.getElementById('dialog-status');
    const passwordStatus = document.getElementById('student-password-status');
    const search = document.getElementById('admin-search');
    const departmentFilter = document.getElementById('admin-department-filter');
    const semesterFilter = document.getElementById('admin-semester-filter');
    const bloodFilter = document.getElementById('admin-blood-filter');
    const projectFilter = document.getElementById('admin-project-filter');
    let students = [];
    let filteredStudents = [];
    const refresh = async () => {
      students = await requestJson(`${api}/students`);
      const selected = departmentFilter.value;
      departmentFilter.replaceChildren(new Option('All departments', ''));
      [...new Set(students.map(student => student.department))].sort().forEach(department => departmentFilter.add(new Option(departmentName(department), department)));
      departmentFilter.value = selected;
      const selectedBloodGroup = bloodFilter.value;
      bloodFilter.replaceChildren(new Option('All blood groups', ''));
      bloodGroups.filter(group => students.some(student => String(student.bloodGroup || '').trim().toUpperCase() === group))
        .forEach(group => bloodFilter.add(new Option(group, group)));
      bloodFilter.value = selectedBloodGroup;
      const departmentInput = form.elements.department;
      const previousDepartment = departmentInput.value;
      const allDepartments = await requestJson(`${api}/students/departments`);
      departmentInput.replaceChildren();
      ['Computer Science', 'Data Science', 'Electronics & Communication', 'Mechanical', 'Civil'].forEach(department => {
        departmentInput.add(new Option(departmentName(department), department));
      });
      departmentInput.value = previousDepartment || allDepartments[0] || departmentInput.options[0].value;
      document.getElementById('admin-total').textContent = students.length;
      document.getElementById('admin-projects').textContent = students.filter(student => student.websiteSubmitted).length;
      renderRows();
    };
    const renderRows = () => {
      const term = search.value.trim().toLowerCase();
      const filtered = students.filter(student => {
        const linkedAccount = student.userId;
        const userEnabled = student.accountEnabled !== false;
        const matchesText = `${student.name} ${student.rollNumber} ${student.email || ''} ${student.websiteTitle || ''} ${student.websiteDescription || ''}`.toLowerCase().includes(term);
        const matchesProject = !projectFilter.value || Boolean(student.websiteSubmitted) === (projectFilter.value === 'submitted');
        const accountStatus = document.getElementById('admin-account-filter').value;
        const matchesAccount = !accountStatus
          || (accountStatus === 'pending' && linkedAccount && student.accountApproved === false)
          || (accountStatus === 'disabled' && linkedAccount && student.accountEnabled === false)
          || (accountStatus === 'enabled' && linkedAccount && student.accountEnabled === true && student.accountApproved === true);
        return matchesText && (!departmentFilter.value || student.department === departmentFilter.value)
          && (!semesterFilter.value || student.semester === semesterFilter.value)
          && (!bloodFilter.value || String(student.bloodGroup || '').trim().toUpperCase() === bloodFilter.value)
          && matchesProject && matchesAccount;
      });
      filteredStudents = sortStudents(filtered);
      document.getElementById('admin-results-count').textContent = `Showing ${filtered.length} of ${students.length} students`;
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-state">No student records match these filters.</td></tr>';
        return;
      }
      tbody.innerHTML = filtered.map(student => `
        <tr>
          <td><div class="admin-student-name">${escapeHtml(student.name)}</div><div class="admin-student-email">${escapeHtml(student.email || '')}</div></td>
          <td>${escapeHtml(student.rollNumber)}</td>
          <td>${escapeHtml(departmentName(student.department))}</td>
          <td>${escapeHtml(student.semester || '—')}</td>
          <td>${escapeHtml(student.bloodGroup || '—')}</td>
          <td>${student.websiteSubmitted ? escapeHtml(student.websiteTitle || 'Submitted') : 'Not submitted'}</td>
          <td>${student.userId ? (student.accountApproved === false ? 'Awaiting approval' : student.accountEnabled === false ? 'Disabled' : 'Active') : 'No account'}</td>
          <td class="table-actions">
            ${safeProjectPath(student) ? `<a class="small-button" href="${safeProjectPath(student)}" target="_blank" rel="noopener">Open website</a>` : ''}
            <button class="small-button" type="button" data-action="edit" data-roll="${escapeHtml(student.rollNumber)}" data-department="${escapeHtml(student.department)}">Edit</button>
            ${student.websiteSubmitted ? '<button class="small-button danger" type="button" data-action="delete-project" data-roll="' + escapeHtml(student.rollNumber) + '" data-department="' + escapeHtml(student.department) + '">Remove project</button>' : ''}
            ${student.userId ? `<button class="small-button" type="button" data-action="toggle" data-roll="${escapeHtml(student.rollNumber)}" data-department="${escapeHtml(student.department)}">${student.accountApproved === false ? 'Approve' : student.accountEnabled === false ? 'Enable' : 'Disable'}</button>` : ''}
            ${student.userId ? `<button class="small-button" type="button" data-action="reset-password" data-roll="${escapeHtml(student.rollNumber)}" data-department="${escapeHtml(student.department)}">Reset password</button>` : ''}
            <button class="small-button danger" type="button" data-action="delete" data-roll="${escapeHtml(student.rollNumber)}" data-department="${escapeHtml(student.department)}">Delete</button>
          </td>
        </tr>`).join('');
    };
    document.getElementById('download-admin-report').addEventListener('click', () =>
      downloadTextReport('Admin Student Report', filteredStudents)
    );
    const openForm = student => {
      form.reset();
      message(status, '');
      form.elements.originalRoll.value = student?.rollNumber || '';
      form.elements.originalDepartment.value = student?.department || '';
      form.elements.name.value = student?.name || '';
      form.elements.rollNumber.value = student?.rollNumber || '';
      form.elements.rollNumber.readOnly = Boolean(student);
      form.elements.department.value = student?.department || departmentFilter.options[1]?.value || '';
      form.elements.semester.value = student?.semester || 'S1';
      form.elements.email.value = student?.email || '';
      form.elements.bloodGroup.value = student?.bloodGroup || '';
      form.elements.websiteTitle.value = student?.websiteTitle || '';
      form.elements.websiteDescription.value = student?.websiteDescription || '';
      form.elements.password.required = !student;
      form.elements.password.value = '';
      document.getElementById('dialog-title').textContent = student ? 'Edit student account' : 'Add a student account';
      dialog.showModal();
    };
    [search, departmentFilter, semesterFilter, bloodFilter, projectFilter, document.getElementById('admin-account-filter')]
      .forEach(control => control.addEventListener(control === search ? 'input' : 'change', renderRows));
    await refresh();
    document.getElementById('add-student-button').addEventListener('click', () => openForm(null));
    document.getElementById('dialog-close').addEventListener('click', () => dialog.close());
    document.getElementById('dialog-cancel').addEventListener('click', () => dialog.close());
    document.getElementById('student-password-close').addEventListener('click', () => passwordDialog.close());
    document.getElementById('student-password-cancel').addEventListener('click', () => passwordDialog.close());
    const accountForm = document.getElementById('admin-account-form');
    const accountStatus = document.getElementById('admin-account-status');
    accountForm.elements.email.value = session.user.email || '';
    accountForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = accountForm.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await requestJson(`${api}/admin/account-settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(accountForm)))
        });
        accountForm.elements.currentPassword.value = '';
        accountForm.elements.newPassword.value = '';
        accountForm.elements.email.value = result.user.email;
        message(accountStatus, result.message);
      } catch (error) {
        message(accountStatus, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    tbody.addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const student = students.find(record => record.rollNumber === button.dataset.roll && record.department === button.dataset.department);
      if (!student) return;
      if (button.dataset.action === 'edit') return openForm(student);
      if (button.dataset.action === 'reset-password') {
        passwordForm.reset();
        passwordForm.elements.rollNumber.value = student.rollNumber;
        passwordForm.elements.department.value = student.department;
        document.getElementById('student-password-title').textContent = `Reset password for ${student.name}`;
        message(passwordStatus, '');
        passwordDialog.showModal();
        return;
      }
      const endpoint = `${api}/students/${encodeURIComponent(student.rollNumber)}?department=${encodeURIComponent(student.department)}`;
      try {
        if (button.dataset.action === 'delete') {
          if (!window.confirm(`Delete ${student.name} and their linked account? This cannot be undone.`)) return;
          await requestJson(endpoint, { method: 'DELETE' });
        } else if (button.dataset.action === 'delete-project') {
          if (!window.confirm(`Delete ${student.name}'s project and uploaded files? This cannot be undone.`)) return;
          await requestJson(`${api}/students/${encodeURIComponent(student.rollNumber)}/project?department=${encodeURIComponent(student.department)}`, { method: 'DELETE' });
        } else {
          const approve = student.accountApproved === false;
          await requestJson(`${api}/students/${encodeURIComponent(student.rollNumber)}/account?department=${encodeURIComponent(student.department)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(approve ? { isApproved: true } : { isEnabled: student.accountEnabled === false })
          });
        }
        await refresh();
      } catch (error) {
        window.alert(error.message);
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const isEdit = Boolean(form.elements.originalRoll.value);
      const payload = Object.fromEntries(new FormData(form));
      delete payload.originalRoll;
      delete payload.originalDepartment;
      const originalRoll = form.elements.originalRoll.value;
      const originalDepartment = form.elements.originalDepartment.value;
      const endpoint = isEdit
        ? `${api}/students/${encodeURIComponent(originalRoll)}?department=${encodeURIComponent(originalDepartment)}`
        : `${api}/students`;
      try {
        await requestJson(endpoint, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        dialog.close();
        await refresh();
      } catch (error) {
        message(status, error.message, true);
      }
    });
    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const password = passwordForm.elements.password.value;
      if (password !== passwordForm.elements.confirmPassword.value) {
        return message(passwordStatus, 'The passwords do not match.', true);
      }
      const roll = encodeURIComponent(passwordForm.elements.rollNumber.value);
      const department = encodeURIComponent(passwordForm.elements.department.value);
      try {
        const result = await requestJson(`${api}/students/${roll}/account/password?department=${department}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        passwordForm.reset();
        passwordDialog.close();
        window.alert(result.message);
      } catch (error) {
        message(passwordStatus, error.message, true);
      }
    });
  }

  async function setupDirectory() {
    const students = await requestJson(`${api}/students`);
    const select = document.getElementById('department-filter');
    const search = document.getElementById('student-search');
    const semester = document.getElementById('semester-filter');
    const bloodGroup = document.getElementById('blood-group-filter');
    const projectStatus = document.getElementById('directory-project-filter');
    const grid = document.getElementById('student-grid');
    const empty = document.getElementById('directory-empty');
    let filteredStudents = [];
    select.replaceChildren(new Option('All departments', ''));
    [...new Set(students.map(student => student.department))].sort().forEach(department => select.add(new Option(departmentName(department), department)));
    bloodGroup.replaceChildren(new Option('All blood groups', ''));
    bloodGroups.filter(group => students.some(student => String(student.bloodGroup || '').trim().toUpperCase() === group))
      .forEach(group => bloodGroup.add(new Option(group, group)));
    const render = () => {
      const term = search.value.trim().toLowerCase();
      const filtered = students.filter(student => {
        const matchesText = `${student.name} ${student.rollNumber} ${student.email || ''} ${student.websiteTitle || ''} ${student.websiteDescription || ''}`.toLowerCase().includes(term);
        return matchesText
          && (!select.value || student.department === select.value)
          && (!semester.value || student.semester === semester.value)
          && (!bloodGroup.value || String(student.bloodGroup || '').trim().toUpperCase() === bloodGroup.value)
          && (!projectStatus.value || Boolean(student.websiteSubmitted) === (projectStatus.value === 'submitted'));
      });
      filteredStudents = sortStudents(filtered);
      document.getElementById('results-count').textContent = `${filtered.length} students`;
      grid.innerHTML = filtered.map(student => `<article class="student-card"><p class="eyebrow">${escapeHtml(departmentName(student.department))} · Roll ${escapeHtml(student.rollNumber)}</p><h2>${escapeHtml(student.name)}</h2><p>${escapeHtml(student.semester || '—')}</p><div class="directory-card-actions"><a class="text-link" href="/profile.html?roll=${encodeURIComponent(student.rollNumber)}&department=${encodeURIComponent(student.department)}">View details <span>↗</span></a>${safeProjectPath(student) ? `<a class="button button-dark" href="${safeProjectPath(student)}" target="_blank" rel="noopener">Open website</a>` : '<span class="project-unavailable">No website submitted</span>'}</div></article>`).join('');
      empty.hidden = filtered.length > 0;
    };
    [select, semester, bloodGroup, projectStatus].forEach(control => control.addEventListener('change', render));
    search.addEventListener('input', render);
    document.getElementById('download-directory-report').addEventListener('click', () =>
      downloadTextReport('Student Directory Report', filteredStudents)
    );
    render();
  }

  async function setupProfile() {
    const params = new URLSearchParams(window.location.search);
    const student = await requestJson(`${api}/students/${encodeURIComponent(params.get('roll') || '')}?department=${encodeURIComponent(params.get('department') || '')}`);
    const path = safeProjectPath(student);
    document.getElementById('profile-content').innerHTML = `<article class="profile-card"><aside class="profile-aside"><p class="eyebrow">Student profile</p><h1>${escapeHtml(student.name)}</h1><span class="profile-roll">Roll ${escapeHtml(student.rollNumber)}</span><div class="profile-department">${escapeHtml(departmentName(student.department))}</div></aside><div class="profile-details"><h2>${escapeHtml(student.websiteTitle || 'Project not submitted')}</h2><p>${escapeHtml(student.websiteDescription || 'No project description yet.')}</p>${path ? `<a class="button button-dark" href="${path}" target="_blank" rel="noopener">Open project ↗</a>` : ''}</div></article>`;
  }

  async function setupShowcase(session) {
    const root = document.getElementById('showcase-projects');
    const projects = await requestJson(`${api}/showcase/projects`);
    if (!projects.length) {
      root.innerHTML = '<div class="empty-state"><span class="empty-illustration">↗</span><h2>No projects have been shared yet.</h2><p>Come back when students have submitted their work.</p></div>';
      return;
    }
    const controls = document.getElementById('showcase-controls');
    const search = document.getElementById('showcase-search');
    const department = document.getElementById('showcase-department');
    const resultsCount = document.getElementById('showcase-results-count');
    const noResults = document.getElementById('showcase-no-results');
    const departments = [...new Set(projects.map(project => project.department).filter(Boolean))]
      .sort((left, right) => departmentName(left).localeCompare(departmentName(right)));
    departments.forEach(value => department.add(new Option(departmentName(value), value)));
    controls.hidden = false;

    const renderProjects = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const selectedDepartment = department.value;
      const filteredProjects = projects.filter(project => {
        const searchableText = [
          project.studentName,
          project.title,
          project.description,
          departmentName(project.department)
        ].join(' ').toLocaleLowerCase();
        return (!query || searchableText.includes(query))
          && (!selectedDepartment || project.department === selectedDepartment);
      });
      root.innerHTML = filteredProjects.map(project => `
        <article class="showcase-card">
          <div class="showcase-listing">
            <div class="showcase-listing-info">
              <p class="eyebrow">${escapeHtml(departmentName(project.department))}</p>
              <h2>${escapeHtml(project.studentName)}${session.student?._id && String(session.student._id) === project.projectId ? '<span class="showcase-own-tag">Your project</span>' : ''}</h2>
              <p class="showcase-project-title">${escapeHtml(project.title)}</p>
              ${project.description ? `<p class="showcase-description">${escapeHtml(project.description)}</p>` : ''}
            </div>
            ${project.websiteUrl ? `<a class="button button-dark" href="${escapeHtml(project.websiteUrl)}" target="_blank" rel="noopener">Open website <span aria-hidden="true">↗</span></a>` : (project.files?.[0]?.previewUrl ? `<a class="button button-dark" href="${escapeHtml(project.files[0].previewUrl)}" target="_blank" rel="noopener">Open project <span aria-hidden="true">↗</span></a>` : '<span class="project-unavailable">Website unavailable</span>')}
          </div>
        </article>`).join('');
      resultsCount.textContent = `Showing ${filteredProjects.length} of ${projects.length} projects`;
      noResults.hidden = filteredProjects.length > 0;
    };

    search.addEventListener('input', renderProjects);
    department.addEventListener('change', renderProjects);
    renderProjects();
  }

  async function run() {
    if (page === 'login') return setupLogin();
    if (page === 'account') return setupRegistration();
    const session = await renderShell();
    if (!session) return;
    if (page === 'dashboard') return setupDashboard(session);
    if (page === 'upload') return setupUpload();
    if (page === 'admin') return setupAdmin(session);
    if (page === 'students') return setupDirectory();
    if (page === 'profile') return setupProfile();
    if (page === 'showcase') return setupShowcase(session);
  }

  run().catch(error => {
    console.error('Page setup failed:', error);
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', `<p class="form-status is-error">${escapeHtml(error.message)}</p>`);
  });
})();
