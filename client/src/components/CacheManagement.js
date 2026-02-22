import React, { useState, useEffect } from 'react';
import { Shield, Database, RefreshCw, Trash2, CheckCircle, XCircle, Clock, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import Header from './Header';
import './AdminPanel.css';

const CacheManagement = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [cacheStats, setCacheStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [regeneratingGenre, setRegeneratingGenre] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  // Genre display names mapping
  const genreDisplayNames = {
    best_sellers: 'Best Sellers',
    booktok_trending: 'BookTok Trending',
    popular: 'Popular Right Now',
    new_releases: 'New This Month',
    hidden_gems: 'Hidden Gems',
    romantasy: 'Romantasy',
    fantasy: 'Fantasy & High Fantasy',
    action_adventure: 'Action & Adventure',
    scifi: 'Science Fiction',
    dark_fantasy: 'Dark Fantasy',
    dragons: 'Dragons & Magic'
  };

  // Sort genres by schedule priority
  const genreOrder = [
    'best_sellers', 'booktok_trending', 'popular', 'new_releases',
    'hidden_gems',
    'romantasy', 'fantasy', 'action_adventure', 'scifi', 'dark_fantasy', 'dragons'
  ];

  useEffect(() => {
    const savedUser = localStorage.getItem('onyx-selected-user');
    if (savedUser) {
      try {
        setSelectedUser(JSON.parse(savedUser));
      } catch (err) {
        console.error('Error parsing saved user:', err);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCacheStats();
      // Poll for updates every 5 seconds when loading
      const interval = setInterval(() => {
        if (loading) fetchCacheStats();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, loading]);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const result = await response.json();

      if (result.success) {
        setIsAuthenticated(true);
        setPin('');
      } else {
        toast.error('Invalid PIN');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Login failed');
    }
  };

  const fetchCacheStats = async () => {
    try {
      const response = await fetch('/api/admin/discovery/genre-stats');
      if (response.ok) {
        const data = await response.json();
        setCacheStats(data);
      }
    } catch (error) {
      console.error('Error fetching cache stats:', error);
    }
  };

  const handleRegenerateGenre = async (genre) => {
    setRegeneratingGenre(genre);
    setLoading(true);

    try {
      const response = await fetch('/api/admin/discovery/regenerate-genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`"${genreDisplayNames[genre]}" regenerated successfully!`);
        await fetchCacheStats();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      console.error('Error regenerating genre:', error);
      toast.error('Error regenerating genre');
    } finally {
      setRegeneratingGenre(null);
      setLoading(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!window.confirm('This will regenerate ALL genres. This may take several minutes. Continue?')) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/admin/discovery/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (result.success) {
        toast.success('All genres regenerated successfully!');
        await fetchCacheStats();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      console.error('Error regenerating all:', error);
      toast.error('Error regenerating cache');
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm('This will clear the entire cache. Continue?')) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/admin/discovery/clear-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Cache cleared successfully!');
        await fetchCacheStats();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast.error('Error clearing cache');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('onyx-selected-user');
    window.location.href = '/';
  };

  const getScheduleBadge = (schedule) => {
    const colors = {
      weekly: 'bg-blue-100 text-blue-800',
      monthly: 'bg-green-100 text-green-800',
      quarterly: 'bg-purple-100 text-purple-800'
    };
    return colors[schedule] || 'bg-gray-100 text-gray-800';
  };

  const getCacheAge = (generatedAt) => {
    if (!generatedAt) return 'Never';
    const now = new Date();
    const generated = new Date(generatedAt);
    const hours = Math.floor((now - generated) / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  return (
    <div className="app">
      <Header
        showSearch={false}
        selectedUser={selectedUser}
        onUserChange={() => window.location.href = '/'}
        onAdminClick={null}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {!isAuthenticated ? (
          <div className="admin-login">
            <h3>Enter Admin PIN</h3>
            <div className="pin-input-group">
              <input
                type="password"
                placeholder="Enter PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                className="pin-input"
                autoFocus
              />
              <button onClick={handleLogin} className="login-button">
                Login
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-dashboard">
            <div className="admin-nav">
              <a href="/admin" className="nav-tab">
                <Shield size={18} />
                Requests
              </a>
              <a href="/admin/imports" className="nav-tab">
                <img src="/import-log-icon.png" alt="" style={{ height: '18px', width: 'auto' }} />
                Import Log
              </a>
              <a href="/admin/cache" className="nav-tab active">
                <Database size={18} />
                Cache
              </a>
            </div>

            <div className="cache-management">
              <div className="cache-header">
                <h2>
                  <Database size={24} />
                  Discovery Cache Management
                </h2>
                <div className="cache-actions">
                  <button
                    onClick={handleRegenerateAll}
                    disabled={loading}
                    className="action-button regenerate-all"
                  >
                    <RefreshCw size={16} />
                    Regenerate All
                  </button>
                  <button
                    onClick={handleClearCache}
                    disabled={loading}
                    className="action-button clear-cache"
                  >
                    <Trash2 size={16} />
                    Clear Cache
                  </button>
                </div>
              </div>

              {cacheStats && (
                <div className="cache-summary">
                  <div className="summary-item">
                    <Clock size={18} />
                    <span>Last Generated: {getCacheAge(cacheStats.generatedAt)}</span>
                  </div>
                  <div className="summary-item">
                    <Database size={18} />
                    <span>Total Genres: {Object.keys(cacheStats.genres || {}).length}</span>
                  </div>
                </div>
              )}

              <div className="genre-table">
                <div className="genre-table-header">
                  <div className="header-cell">Genre</div>
                  <div className="header-cell">Schedule</div>
                  <div className="header-cell">Books</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>

                {genreOrder.map((genre) => {
                  const stats = cacheStats?.genres?.[genre];
                  const displayName = genreDisplayNames[genre] || genre;

                  return (
                    <div key={genre} className="genre-table-row">
                      <div className="cell genre-name">
                        {displayName}
                        <div className="genre-key">{genre}</div>
                      </div>
                      <div className="cell">
                        <span className={`schedule-badge ${getScheduleBadge(stats?.schedule)}`}>
                          <Calendar size={12} />
                          {stats?.schedule || 'unknown'}
                        </span>
                        <div className="schedule-desc">{stats?.scheduleDescription || 'N/A'}</div>
                      </div>
                      <div className="cell">
                        {stats?.cached ? (
                          <span className="book-count">{stats.bookCount || 0}</span>
                        ) : (
                          <span className="book-count empty">—</span>
                        )}
                      </div>
                      <div className="cell">
                        {stats?.cached ? (
                          <span className="status-badge success">
                            <CheckCircle size={12} />
                            Cached
                          </span>
                        ) : (
                          <span className="status-badge empty">
                            <XCircle size={12} />
                            Not Cached
                          </span>
                        )}
                      </div>
                      <div className="cell">
                        <button
                          onClick={() => handleRegenerateGenre(genre)}
                          disabled={loading || regeneratingGenre === genre}
                          className="regenerate-button"
                        >
                          {regeneratingGenre === genre ? (
                            <>
                              <RefreshCw size={14} className="spinning" />
                              Regenerating...
                            </>
                          ) : (
                            <>
                              <RefreshCw size={14} />
                              Regenerate
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {loading && (
                <div className="loading-overlay">
                  <div className="loading-spinner"></div>
                  <p>Processing cache...</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default CacheManagement;
