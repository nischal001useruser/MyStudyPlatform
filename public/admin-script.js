// Admin Dashboard JavaScript - Updated with File Upload Support

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadUsers();
    loadQuestions();
    loadLogs();
    loadMaterials();

    document.querySelectorAll('.admin-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const section = e.currentTarget.dataset.section;
            if (section) {
                e.preventDefault();
                switchSection(section);
            }
        });
    });

    document.getElementById('material-form')?.addEventListener('submit', handleMaterialUpload);
    document.getElementById('notification-form')?.addEventListener('submit', handleNotificationSend);
    document.getElementById('edit-user-form')?.addEventListener('submit', handleUserUpdate);
});

// Toggle material form fields based on type
function toggleMaterialFields() {
    const type = document.getElementById('material-type').value;
    const contentField = document.getElementById('content-field');
    const linkField = document.getElementById('link-field');
    const fileField = document.getElementById('file-field');
    
    contentField.style.display = 'none';
    linkField.style.display = 'none';
    fileField.style.display = 'none';
    
    switch(type) {
        case 'note':
            contentField.style.display = 'block';
            break;
        case 'link':
            linkField.style.display = 'block';
            break;
        case 'document':
            fileField.style.display = 'block';
            contentField.style.display = 'block'; // Also allow description
            break;
    }
}

function switchSection(sectionName) {
    document.querySelectorAll('.admin-nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');
    document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
    document.getElementById(`${sectionName}-section`)?.classList.add('active');

    switch(sectionName) {
        case 'users': loadUsers(); break;
        case 'questions': loadQuestions(); break;
        case 'logs': loadLogs(); break;
        case 'materials': loadMaterials(); break;
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats');
        const stats = await response.json();
        document.getElementById('stat-total-users').textContent = stats.totalUsers || 0;
        document.getElementById('stat-active-users').textContent = stats.activeUsers || 0;
        document.getElementById('stat-total-notes').textContent = stats.totalNotes || 0;
        document.getElementById('stat-total-tasks').textContent = stats.totalTasks || 0;
        document.getElementById('stat-total-questions').textContent = stats.totalQuestions || 0;
        document.getElementById('stat-total-answers').textContent = stats.totalAnswers || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load and display materials
async function loadMaterials() {
    const container = document.getElementById('materials-list');
    if (!container) return;
    
    try {
        const response = await fetch('/api/admin/materials');
        const data = await response.json();
        
        if (!data.materials || data.materials.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #64748b;">
                    <span class="material-icons-outlined" style="font-size: 3rem; opacity: 0.5;">folder_open</span>
                    <p>No materials uploaded yet</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = data.materials.map(m => `
            <div class="material-item">
                <div class="material-info">
                    <div class="material-icon-box ${m.type}">
                        <span class="material-icons-outlined">
                            ${m.type === 'note' ? 'description' : m.type === 'link' ? 'link' : 'attach_file'}
                        </span>
                    </div>
                    <div class="material-details">
                        <h4>${escapeHtml(m.title)}</h4>
                        <p>
                            <span style="text-transform: capitalize;">${m.type}</span> • 
                            ${m.target_group === 'all' ? 'All Users' : capitalizeFirst(m.target_group)} • 
                            ${new Date(m.created_at).toLocaleDateString()}
                            ${m.file_path ? ' • <span style="color: #10b981;">📎 File</span>' : ''}
                        </p>
                    </div>
                </div>
                <div class="material-actions">
                    ${m.file_path ? `
                        <a href="/download-material/${m.id}" class="action-btn btn-success" style="text-decoration: none;">
                            <span class="material-icons-outlined" style="font-size: 1rem;">download</span>
                        </a>
                    ` : ''}
                    ${m.link_url ? `
                        <a href="${escapeHtml(m.link_url)}" target="_blank" class="action-btn btn-primary" style="text-decoration: none;">
                            <span class="material-icons-outlined" style="font-size: 1rem;">open_in_new</span>
                        </a>
                    ` : ''}
                    <button class="action-btn btn-danger" onclick="deleteMaterial(${m.id}, '${escapeHtml(m.title)}')">
                        <span class="material-icons-outlined" style="font-size: 1rem;">delete</span>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading materials:', error);
        container.innerHTML = '<p style="color: red; text-align: center;">Error loading materials</p>';
    }
}

// Handle material upload with file support
async function handleMaterialUpload(e) {
    e.preventDefault();
    
    const form = e.target;
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="material-icons-outlined" style="animation: spin 1s linear infinite;">sync</span> Uploading...';
    
    try {
        const response = await fetch('/api/admin/materials', {
            method: 'POST',
            body: formData // FormData handles file upload automatically
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Material uploaded successfully!', 'success');
            form.reset();
            toggleMaterialFields(); // Reset form fields visibility
            loadMaterials(); // Refresh materials list
        } else {
            showToast(result.error || 'Upload failed', 'error');
        }
    } catch (error) {
        console.error('Error uploading material:', error);
        showToast('Error uploading material', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
}

// Delete material
async function deleteMaterial(id, title) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    
    try {
        const response = await fetch(`/api/admin/materials/${id}`, { method: 'DELETE' });
        const result = await response.json();
        
        if (result.success) {
            showToast('Material deleted', 'success');
            loadMaterials();
        } else {
            showToast(result.error || 'Delete failed', 'error');
        }
    } catch (error) {
        console.error('Error deleting material:', error);
        showToast('Error deleting material', 'error');
    }
}

// --- Rest of the existing functions ---

async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const data = await response.json();
        const tbody = document.getElementById('users-table-body');
        if (data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No users found</td></tr>';
            return;
        }
        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td>${user.id}</td>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.email || 'N/A')}</td>
                <td><span class="badge badge-${user.role || 'student'}">${capitalizeFirst(user.role || 'student')}</span></td>
                <td>${user.notes_count || 0}</td>
                <td>${user.tasks_count || 0}</td>
                <td><span class="badge ${user.is_active ? 'badge-active' : 'badge-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="action-btn btn-primary" onclick="editUser(${user.id})">Edit</button>
                    <button class="action-btn btn-danger" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('users-table-body').innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: red;">Error loading users</td></tr>';
    }
}

function refreshUsers() { loadUsers(); showToast('Users refreshed', 'success'); }

async function editUser(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`);
        const data = await response.json();
        const user = data.user;
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-email').value = user.email || 'N/A';
        document.getElementById('edit-role').value = user.role || 'student';
        document.getElementById('edit-user-modal').style.display = 'block';
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Error loading user details', 'error');
    }
}

function closeEditModal() { document.getElementById('edit-user-modal').style.display = 'none'; }

async function handleUserUpdate(e) {
    e.preventDefault();
    const userId = document.getElementById('edit-user-id').value;
    const role = document.getElementById('edit-role').value;
    try {
        const response = await fetch(`/api/admin/users/${userId}/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role })
        });
        const data = await response.json();
        if (data.success) { showToast('User updated successfully', 'success'); closeEditModal(); loadUsers(); }
        else { showToast(data.error || 'Update failed', 'error'); }
    } catch (error) { console.error('Error updating user:', error); showToast('Error updating user', 'error'); }
}

async function deleteUser(userId, username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
        const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) { showToast('User deleted successfully', 'success'); loadUsers(); }
        else { showToast(data.error || 'Delete failed', 'error'); }
    } catch (error) { console.error('Error deleting user:', error); showToast('Error deleting user', 'error'); }
}

async function loadQuestions() {
    try {
        const response = await fetch('/api/admin/questions');
        const data = await response.json();
        const tbody = document.getElementById('questions-table-body');
        if (data.questions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No questions found</td></tr>';
            return;
        }
        tbody.innerHTML = data.questions.map(q => `
            <tr>
                <td>${q.id}</td>
                <td>${escapeHtml(q.student_name || 'Unknown')}</td>
                <td>${escapeHtml(q.title)}</td>
                <td>${escapeHtml(q.subject || 'General')}</td>
                <td><span class="badge badge-${q.status}">${capitalizeFirst(q.status)}</span></td>
                <td>${escapeHtml(q.teacher_name || 'Unassigned')}</td>
                <td>${q.answer_count || 0}</td>
                <td><button class="action-btn btn-primary" onclick="viewQuestion(${q.id})">View</button></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading questions:', error);
        document.getElementById('questions-table-body').innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: red;">Error loading questions</td></tr>';
    }
}

function viewQuestion(questionId) { showToast('Question details view coming soon!', 'info'); }

async function loadLogs() {
    try {
        const response = await fetch('/api/admin/logs');
        const data = await response.json();
        const tbody = document.getElementById('logs-table-body');
        if (data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No logs found</td></tr>';
            return;
        }
        tbody.innerHTML = data.logs.map(log => `
            <tr>
                <td>${new Date(log.created_at).toLocaleString()}</td>
                <td>${escapeHtml(log.admin_name)}</td>
                <td><span class="badge badge-primary">${escapeHtml(log.action)}</span></td>
                <td>${escapeHtml(log.details || 'N/A')}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('logs-table-body').innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: red;">Error loading logs</td></tr>';
    }
}

async function handleNotificationSend(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        title: formData.get('title'),
        message: formData.get('message'),
        target_type: formData.get('target_type'),
        target_ids: formData.get('target_ids') ? formData.get('target_ids').split(',').map(id => id.trim()) : null
    };
    try {
        const response = await fetch('/api/admin/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) { showToast('Notification sent successfully', 'success'); e.target.reset(); }
        else { showToast(result.error || 'Send failed', 'error'); }
    } catch (error) { console.error('Error sending notification:', error); showToast('Error sending notification', 'error'); }
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

function capitalizeFirst(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; top: 20px; right: 20px; background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'}; color: white; padding: 1rem 1.5rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 10000; animation: slideIn 0.3s ease;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'slideOut 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3000);
}

window.onclick = function(event) { if (event.target === document.getElementById('edit-user-modal')) closeEditModal(); }

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);