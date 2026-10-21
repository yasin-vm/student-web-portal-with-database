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
  const maxUploadFiles = 10;
  const maxUploadFileSize = 10 * 1024 * 1024;
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
  const passwordEyeIcon = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7"></circle>
    </svg>`;
  const passwordEyeOffIcon = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.1 0 9.5 6 9.5 6a16 16 0 0 1-3.1 3.7M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6c1.2 0 2.3-.3 3.2-.7M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  const addPasswordVisibilityToggle = input => {
    if (input.type !== 'password' || input.closest('.password-input-wrap')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'password-input-wrap';
    const toggle = document.createElement('button');
    toggle.className = 'password-visibility-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = 'Show password';
    toggle.innerHTML = passwordEyeIcon;
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input, toggle);

    toggle.addEventListener('click', () => {
      const showPassword = input.type === 'password';
      input.type = showPassword ? 'text' : 'password';
      toggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(showPassword));
      toggle.title = showPassword ? 'Hide password' : 'Show password';
      toggle.innerHTML = showPassword ? passwordEyeOffIcon : passwordEyeIcon;
    });
  };
  const setupPasswordVisibility = () => {
    document.querySelectorAll('input[type="password"]').forEach(addPasswordVisibilityToggle);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches('input[type="password"]')) addPasswordVisibilityToggle(node);
          node.querySelectorAll('input[type="password"]').forEach(addPasswordVisibilityToggle);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
            <h2 id="dashboard-project-title">${escapeHtml(student.websiteTitle || (student.websiteSubmitted ? 'Project submitted' : 'No project yet'))}</h2>
            <p id="dashboard-project-description">${escapeHtml(student.websiteDescription || 'Add project details and upload your files to share your work.')}</p>
            <div class="hero-actions">
              <a class="button button-dark" href="/upload.html">${student.websiteSubmitted ? 'Update project' : 'Upload a project'} <span aria-hidden="true">↗</span></a>
              ${path ? `<a class="text-link" href="${path}" target="_blank" rel="noopener">Open your website</a>` : ''}
            </div>
          </section>
          <div class="dashboard-actions">
            <button id="project-details-open" class="button button-quiet" type="button">Edit project details</button>
            <button id="password-settings-open" class="button button-quiet" type="button">Change password</button>
          </div>
        </div>
      </section>
      <dialog id="project-details-dialog" class="student-dialog">
        <form id="project-details-form">
          <div class="dialog-heading"><div><p class="eyebrow">Your project</p><h2>Edit project details</h2></div><button type="button" class="icon-button" data-close-dialog="project-details-dialog" aria-label="Close">×</button></div>
          <label class="form-field"><span>Project title</span><input name="title" maxlength="160" value="${escapeHtml(student.websiteTitle || '')}"></label>
          <label class="form-field"><span>Description</span><textarea name="description" rows="3" maxlength="3000">${escapeHtml(student.websiteDescription || '')}</textarea></label>
          <label class="form-field"><span>Semester</span><select name="semester">${Array.from({ length: 8 }, (_, index) => `S${index + 1}`).map(semester => `<option ${student.semester === semester ? 'selected' : ''}>${semester}</option>`).join('')}</select></label>
          <div class="dialog-actions"><button class="button button-quiet" type="button" data-close-dialog="project-details-dialog">Cancel</button><button class="button button-dark" type="submit">Save project details</button></div>
          <p id="project-details-status" class="form-status" aria-live="polite"></p>
        </form>
      </dialog>
      <dialog id="password-settings-dialog" class="student-dialog">
        <form id="student-password-settings-form">
          <div class="dialog-heading"><div><p class="eyebrow">Account security</p><h2>Change password</h2></div><button type="button" class="icon-button" data-close-dialog="password-settings-dialog" aria-label="Close">×</button></div>
          <p class="form-intro">Enter your current password to set a new one.</p>
          <label class="form-field"><span>Current password <i>*</i></span><input name="currentPassword" type="password" required autocomplete="current-password"></label>
          <label class="form-field"><span>New password <i>*</i></span><input name="newPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
          <label class="form-field"><span>Confirm new password <i>*</i></span><input name="confirmPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
          <div class="dialog-actions"><button class="button button-quiet" type="button" data-close-dialog="password-settings-dialog">Cancel</button><button class="button button-dark" type="submit">Save new password</button></div>
          <p id="student-password-settings-status" class="form-status" aria-live="polite"></p>
        </form>
      </dialog>`;
    const form = document.getElementById('project-details-form');
    const status = document.getElementById('project-details-status');
    const projectDialog = document.getElementById('project-details-dialog');
    const passwordDialog = document.getElementById('password-settings-dialog');
    document.getElementById('project-details-open').addEventListener('click', () => projectDialog.showModal());
    document.getElementById('password-settings-open').addEventListener('click', () => passwordDialog.showModal());
    root.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const project = Object.fromEntries(new FormData(form));
        await requestJson(`${api}/student/project`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(project)
        });
        student.websiteTitle = project.title;
        student.websiteDescription = project.description;
        student.semester = project.semester;
        document.getElementById('dashboard-project-title').textContent = project.title || (student.websiteSubmitted ? 'Project submitted' : 'No project yet');
        document.getElementById('dashboard-project-description').textContent = project.description || 'Add project details and upload your files to share your work.';
        root.querySelector('.detail-item:nth-child(2) strong').textContent = project.semester;
        message(status, 'Project details saved.');
        projectDialog.close();
      } catch (error) {
        message(status, error.message, true);
      }
    });
    const passwordForm = document.getElementById('student-password-settings-form');
    const passwordStatus = document.getElementById('student-password-settings-status');
    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (passwordForm.elements.newPassword.value !== passwordForm.elements.confirmPassword.value) {
        return message(passwordStatus, 'The new passwords do not match.', true);
      }
      const button = passwordForm.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const result = await requestJson(`${api}/student/account/password`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: passwordForm.elements.currentPassword.value,
            newPassword: passwordForm.elements.newPassword.value
          })
        });
        message(passwordStatus, result.message);
        passwordForm.reset();
        passwordDialog.close();
      } catch (error) {
        message(passwordStatus, error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  function setupUpload() {
    const form = document.getElementById('upload-form');
    const input = document.getElementById('project-files');
    const status = document.getElementById('upload-status');
    const label = document.getElementById('file-label');
    const fileList = document.getElementById('file-selection');
    const submitButton = form.querySelector('[type="submit"]');
    const formatFileSize = bytes => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      fileList.replaceChildren();
      if (!files.length) {
        label.textContent = 'Drop your files here, or browse';
        message(status, '');
        submitButton.disabled = false;
        return;
      }

      label.textContent = `${files.length} file${files.length === 1 ? '' : 's'} selected`;
      files.forEach(file => {
        const item = document.createElement('li');
        item.textContent = `${file.name} · ${formatFileSize(file.size)}`;
        fileList.append(item);
      });
      const oversizedFile = files.find(file => file.size > maxUploadFileSize);
      if (files.length > maxUploadFiles) {
        message(status, `Choose no more than ${maxUploadFiles} files.`, true);
        submitButton.disabled = true;
      } else if (oversizedFile) {
        message(status, `${oversizedFile.name} is larger than the 10 MB per-file limit.`, true);
        submitButton.disabled = true;
      } else {
        message(status, `${files.length} file${files.length === 1 ? '' : 's'} ready to submit.`);
        submitButton.disabled = false;
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!input.files.length) return message(status, 'Choose at least one project file.', true);
      if (input.files.length > maxUploadFiles) return message(status, `You can upload at most ${maxUploadFiles} files at a time.`, true);
      const files = Array.from(input.files);
      const oversizedFile = files.find(file => file.size > maxUploadFileSize);
      if (oversizedFile) return message(status, `${oversizedFile.name} is larger than the 10 MB per-file limit.`, true);
      const data = new FormData(form);
      data.delete('project-files');
      files.forEach(file => {
        data.append(files.length === 1 ? 'assignmentFile' : 'assignmentFiles', file);
        if (files.length > 1) data.append('paths', file.webkitRelativePath || file.name);
      });
      submitButton.disabled = true;
      try {
        const result = await requestJson(`${api}/assignments/self-submit`, { method: 'POST', body: data });
        message(status, `${result.message} Your submission is complete.`);
        const dashboardLink = document.createElement('a');
        dashboardLink.className = 'button button-quiet upload-dashboard-link';
        dashboardLink.href = '/dashboard.html';
        dashboardLink.textContent = 'View my dashboard';
        status.append(document.createElement('br'), dashboardLink);
        input.value = '';
        fileList.replaceChildren();
        label.textContent = 'Drop your files here, or browse';
      } catch (error) {
        message(status, error.message, true);
      } finally {
        submitButton.disabled = false;
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

  setupPasswordVisibility();
  run().catch(error => {
    console.error('Page setup failed:', error);
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', `<p class="form-status is-error">${escapeHtml(error.message)}</p>`);
  });
})();
