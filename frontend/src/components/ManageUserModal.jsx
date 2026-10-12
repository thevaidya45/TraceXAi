export default function ManageUserModal({ user, communities, saving, error, onClose, onSave, onDelete }) {
  if (!user) {
    return null;
  }

  const communityId = user.community && user.community.id ? user.community.id : '';

  function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    onSave({
      role: form.get('role'),
      communityId: form.get('communityId'),
      status: form.get('status')
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-labelledby="manage-user-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="manage-user-title">Manage User</h2>
        <p className="muted-text">{user.name}</p>
        <p className="email-hint">{user.email}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Role</span>
            <select name="role" defaultValue={user.role} required>
              <option value="student">Student</option>
              <option value="employee">Employee</option>
            </select>
          </label>
          <label className="field">
            <span>Community</span>
            <select name="communityId" defaultValue={communityId} required>
              <option value="">Select community</option>
              {communities.map((community) => (
                <option key={community.id} value={community.id}>
                  {community.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={user.status || 'active'} required>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={saving}>
              Delete user
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
