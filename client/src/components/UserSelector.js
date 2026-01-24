import React, { useState, useEffect } from 'react';
import { User, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import './UserSelector.css';

const UserSelector = ({ isOpen, onClose, onSelectUser }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      // Add timeout to prevent infinite loading
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch('/api/abs/users', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.success) {
        setUsers(data.users.filter(user => user.isActive));
        console.log('[DEBUG] Fetched ABS users:', data.users.length);
      } else {
        setError(data.message || 'Failed to fetch users');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timeout - Audiobookshelf connection is slow');
      } else {
        setError('Error connecting to Audiobookshelf');
      }
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectUser = () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    const selectedUser = users.find(user => user.id === selectedUserId);
    if (selectedUser) {
      // Save to localStorage
      localStorage.setItem('onyx-selected-user', JSON.stringify({
        id: selectedUser.id,
        username: selectedUser.username,
        email: selectedUser.email,
        selectedAt: new Date().toISOString()
      }));

      onSelectUser(selectedUser);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="user-selector-overlay" onClick={onClose}>
      <div className="user-selector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="user-selector-header">
          <h2>Select Your Audiobookshelf Account</h2>
          <button className="close-button" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="user-selector-content">
          <p className="user-selector-description">
            Choose your Audiobookshelf account to link your book requests.
            This is a one-time setup - your selection will be remembered.
          </p>

          {loading && (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading users from Audiobookshelf...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p className="error-message">{error}</p>
              <button onClick={fetchUsers} className="retry-button">
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && users.length === 0 && (
            <div className="empty-state">
              <p>No active users found in Audiobookshelf</p>
            </div>
          )}

          {!loading && !error && users.length > 0 && (
            <>
              <div className="users-list">
                {users.map(user => (
                  <label
                    key={user.id}
                    className={`user-option ${selectedUserId === user.id ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="user"
                      value={user.id}
                      checked={selectedUserId === user.id}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                    />
                    <div className="user-content">
                      <User size={20} />
                      <div className="user-info">
                        <span className="username">{user.username}</span>
                        {user.email && <span className="email">{user.email}</span>}
                      </div>
                      {selectedUserId === user.id && (
                        <Check size={20} className="check-icon" />
                      )}
                    </div>
                  </label>
                ))}
              </div>

              <div className="user-selector-actions">
                <button onClick={onClose} className="cancel-button">
                  Cancel
                </button>
                <button
                  onClick={handleSelectUser}
                  className={`confirm-button ${!selectedUserId ? 'disabled' : ''}`}
                  disabled={!selectedUserId}
                >
                  Select User
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserSelector;