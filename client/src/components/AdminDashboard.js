import React, { useState, useEffect } from 'react';
import { Shield, Search, Download, Clock, X, MessageCircle, Database } from 'lucide-react';
import toast from 'react-hot-toast';
import Header from './Header';
import './AdminPanel.css';

const AdminDashboard = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [requests, setRequests] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Telegram auth state
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [showTelegramAuth, setShowTelegramAuth] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      fetchRequests();
      fetchTelegramStatus();
    }
  }, [isAuthenticated]);

  const fetchTelegramStatus = async () => {
    try {
      const response = await fetch('/api/telegram/status');
      const data = await response.json();
      setTelegramStatus(data);
    } catch (error) {
      console.error('Error fetching Telegram status:', error);
    }
  };

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

  const fetchRequests = async () => {
    try {
      const response = await fetch('/api/admin/requests');
      const data = await response.json();
      setRequests(data);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

  const handleSearch = async (request) => {
    // Consolidate search query logic: use state if editing this row, else use request title
    const effectiveQuery = (activeRequest?.id === request.id && searchQuery.trim())
      ? searchQuery
      : request.title;

    if (!effectiveQuery || !effectiveQuery.trim()) {
      toast.error('Please enter a search query');
      return;
    }

    setLoading(true);
    setActiveRequest(request);
    setSearchQuery(effectiveQuery);

    try {
      const response = await fetch(`/api/admin/search/${request.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: effectiveQuery }),
      });

      const result = await response.json();

      if (result.success) {
        setSearchResults(result.results);
      } else {
        toast.error('Search failed: ' + result.message);
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (result) => {
    if (!activeRequest) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/admin/download/${activeRequest.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          magnetUrl: result.magnetUrl,
          title: result.title,
          tracker: result.tracker,
          source: result.source || 'prowlarr',
          downloadInfo: result.source === 'telegram' ? {
            title: result.title,
            downloadCommand: result.downloadCommand,
            messageId: result.messageId,
          } : null,
        }),
      });

      const downloadResult = await response.json();

      if (downloadResult.success) {
        toast.success('Download started successfully!');
        setSearchResults([]);
        setActiveRequest(null);
        fetchRequests();
      } else {
        toast.error('Download failed: ' + downloadResult.message);
      }
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Download failed');
    } finally {
      setLoading(false);
    }
  };

  // Get user from localStorage for header
  const [selectedUser, setSelectedUser] = useState(null);

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

  const handleLogout = () => {
    localStorage.removeItem('onyx-selected-user');
    window.location.href = '/';
  };

  // Telegram auth handlers
  const handleTelegramPhone = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/telegram/auth/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Code sent to your Telegram app!');
        fetchTelegramStatus();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      toast.error('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTelegramCode = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/telegram/auth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: authCode }),
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Telegram connected!');
        setShowTelegramAuth(false);
        fetchTelegramStatus();
      } else if (result.needsPassword) {
        fetchTelegramStatus();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      toast.error('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTelegramPassword = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/telegram/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: authPassword }),
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Telegram connected with 2FA!');
        setShowTelegramAuth(false);
        fetchTelegramStatus();
      } else {
        toast.error('Failed: ' + result.message);
      }
    } catch (error) {
      toast.error('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Telegram Auth Modal - rendered inline to prevent re-mount issues
  const renderTelegramAuthModal = () => {
    if (!showTelegramAuth) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowTelegramAuth(false)}>
        <div className="modal-content telegram-auth-modal" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setShowTelegramAuth(false)}>
            <X size={20} />
          </button>
          <h3>📱 Telegram Setup</h3>

          {telegramStatus?.authState === 'unconfigured' && (
            <div className="auth-section">
              <p>⚠️ Telegram not configured. Add these to your .env:</p>
              <code>TELEGRAM_API_ID, TELEGRAM_API_HASH, ZLIBRARY_BOT_USERNAME</code>
            </div>
          )}

          {telegramStatus?.authState === 'needs_phone' && (
            <div className="auth-section">
              <p>Enter your phone number (with country code):</p>
              <input
                type="tel"
                placeholder="+1234567890"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                className="auth-input"
                autoComplete="off"
              />
              <button onClick={handleTelegramPhone} disabled={loading} className="auth-button">
                Send Code
              </button>
            </div>
          )}

          {telegramStatus?.authState === 'needs_code' && (
            <div className="auth-section">
              <p>Enter the code from your Telegram app:</p>
              <input
                type="text"
                placeholder="12345"
                value={authCode}
                onChange={e => setAuthCode(e.target.value)}
                className="auth-input"
                autoComplete="off"
              />
              <button onClick={handleTelegramCode} disabled={loading} className="auth-button">
                Verify Code
              </button>
            </div>
          )}

          {telegramStatus?.authState === 'needs_password' && (
            <div className="auth-section">
              <p>Enter your Telegram 2FA password:</p>
              <input
                type="password"
                placeholder="Telegram 2FA Password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="auth-input"
                autoComplete="new-password"
                name="telegram-2fa-password"
                id="telegram-2fa-password"
              />
              <button onClick={handleTelegramPassword} disabled={loading} className="auth-button">
                Submit
              </button>
            </div>
          )}

          {telegramStatus?.authState === 'ready' && (
            <div className="auth-section success">
              <p>✅ Connected to Telegram!</p>
              <p>Bot: {telegramStatus.botUsername}</p>
            </div>
          )}
        </div>
      </div>
    );
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
              <a href="/admin" className="nav-tab active">
                <Shield size={18} />
                Requests
              </a>
              <a href="/admin/imports" className="nav-tab">
                <img src="/import-log-icon.png" alt="" style={{ height: '18px', width: 'auto' }} />
                Import Log
              </a>
              <a href="/admin/cache" className="nav-tab">
                <Database size={18} />
                Cache
              </a>
              {telegramStatus && (
                <button
                  className={`nav-tab telegram-status ${telegramStatus.authState === 'ready' ? 'connected' : 'disconnected'}`}
                  onClick={() => setShowTelegramAuth(true)}
                  style={{ marginLeft: 'auto', cursor: 'pointer', border: 'none', background: 'transparent' }}
                >
                  <MessageCircle size={18} />
                  {telegramStatus.authState === 'ready' ? 'Telegram ✓' : 'Telegram Setup'}
                </button>
              )}
            </div>

            <div className="pending-requests">
              <h3>Pending Requests ({requests.length})</h3>
              {requests.length === 0 ? (
                <p className="no-requests">No pending requests</p>
              ) : (
                requests.map((request) => (
                  <div key={request.id} className="request-card">
                    <div className="request-info">
                      <h4>{request.title}</h4>
                      <p>by {request.author}</p>
                      {request.requestTypes && (
                        <div className="request-types">
                          {request.requestTypes.audiobook && <span className="format-badge audiobook">Audiobook</span>}
                          {request.requestTypes.ebook && <span className="format-badge ebook">Ebook</span>}
                        </div>
                      )}
                      {request.username && (
                        <div className="user-info">
                          <span className="user-name">Requested by: {request.username}</span>
                          {request.userEmail && (
                            <span className="user-email">📧 {request.userEmail}</span>
                          )}
                        </div>
                      )}
                      <span className="request-time">
                        <Clock size={14} />
                        {new Date(request.createdAt || request.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="request-actions">
                      <input
                        type="text"
                        placeholder="Search query..."
                        value={activeRequest?.id === request.id ? searchQuery : request.title}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setActiveRequest(request);
                        }}
                        className="search-input-small"
                      />
                      <button
                        onClick={() => handleSearch(request)}
                        disabled={loading}
                        className="search-button"
                      >
                        <Search size={16} />
                        Search
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="search-results">
                <h3>Search Results for "{searchQuery}"</h3>
                <div className="results-list">
                  {searchResults.map((result, index) => (
                    <div key={index} className="result-card">
                      <div className="result-info">
                        <div className="result-header">
                          <h4>{result.title}</h4>
                          <span className={`source-badge ${result.source === 'telegram' ? 'telegram' : 'torrent'}`}>
                            {result.source === 'telegram' ? '📱 Telegram' : '🧲 Torrent'}
                          </span>
                          {result.indexer && <span className="result-indexer">📡 {result.indexer}</span>}
                        </div>
                        <div className="result-details">
                          <span className="result-size">💾 {result.formattedSize}</span>
                          <span className="result-seeders">🌱 {result.source === 'telegram' ? 'Direct' : `${result.seeders} seeders`}</span>
                          <span className="result-category">📚 {result.categoryName}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload(result)}
                        disabled={loading}
                        className="download-button"
                      >
                        <Download size={16} />
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="loading-overlay">
                <div className="loading-spinner"></div>
                <p>Processing...</p>
              </div>
            )}
          </div>
        )}
      </main>
      {renderTelegramAuthModal()}
    </div>
  );
};

export default AdminDashboard;