import { useEffect, useState } from 'react';
import { Shield, UserPlus, Trash2 } from 'lucide-react';

type User = { id: string; username: string; role: 'Admin' | 'ReadOnly'; isEnabled: boolean; lastLoginAtUtc?: string };

export default function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'Admin' | 'ReadOnly'>('ReadOnly');
  const [message, setMessage] = useState('');
  const load = async () => { const res = await fetch('/api/users'); if (res.ok) setUsers(await res.json()); };
  useEffect(() => {
    let active = true;
    fetch('/api/users')
      .then(response => response.ok ? response.json() as Promise<User[]> : [])
      .then(data => { if (active) setUsers(data); });
    return () => { active = false; };
  }, []);
  const update = async (id: string, body: object) => { const res = await fetch(`/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json().catch(() => ({})); setMessage(res.ok ? 'User updated.' : data.error || 'Update failed.'); if (res.ok) void load(); };
  return <div className="panel user-management">
    <div className="panel-header"><h2 className="panel-title"><Shield size={17} /> Local Access</h2></div>
    <p className="text-secondary user-management-copy">Manage who can view or configure this edge node.</p>
    <form className="user-create-row" onSubmit={async e => { e.preventDefault(); const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) }); const data = await res.json().catch(() => ({})); setMessage(res.ok ? 'User created.' : data.error || 'Creation failed.'); if (res.ok) { setUsername(''); setPassword(''); void load(); } }}>
      <input className="form-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
      <input className="form-input" type="password" placeholder="Temporary password" value={password} onChange={e => setPassword(e.target.value)} required />
      <select className="form-input" value={role} onChange={e => setRole(e.target.value as 'Admin' | 'ReadOnly')}><option value="ReadOnly">Read-only</option><option value="Admin">Admin</option></select>
      <button className="btn-primary"><UserPlus size={15} /> Add user</button>
    </form>
    {message && <p className="user-message">{message}</p>}
    <div className="user-list">{users.map(user => <div className="user-row" key={user.id}>
      <div className="user-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
      <div className="user-identity"><strong>{user.username}</strong><span>{user.lastLoginAtUtc ? `Last sign-in ${new Date(user.lastLoginAtUtc).toLocaleString()}` : 'Never signed in'}</span></div>
      <select className="form-input user-role" value={user.role} onChange={e => void update(user.id, { role: e.target.value })}><option value="ReadOnly">Read-only</option><option value="Admin">Admin</option></select>
      <label className="user-enabled"><input type="checkbox" checked={user.isEnabled} onChange={e => void update(user.id, { isEnabled: e.target.checked })} /> Enabled</label>
      <button className="user-delete" disabled={user.id === currentUserId} title="Delete user" onClick={async () => { const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' }); const data = await res.json().catch(() => ({})); setMessage(res.ok ? 'User deleted.' : data.error || 'Delete failed.'); if (res.ok) void load(); }}><Trash2 size={15} /></button>
    </div>)}</div>
  </div>;
}
