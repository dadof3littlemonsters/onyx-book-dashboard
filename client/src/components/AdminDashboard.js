import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Search, Download, Clock, X, MessageCircle, Database, Users, Check, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import Header from './Header';
import { useAuth } from '../context/AuthContext';
import './AdminPanel.css';

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const [requests, setRequests] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('requests');
  const [downloadJobs, setDownloadJobs] = useState([]);
  const [pipelineStatus, setPipelineStatus] = useState(null);

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userActionLoading, setUserActionLoading] = useState({});
  const [userWarnings, setUserWarnings] = useState({});

  // Telegram auth state
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [showTelegramAuth, setShowTelegramAuth] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  useEffect(() => {
    fetchRequests();
    fetchTelegramStatus();
    fetchUsers();
    fetchDownloadJobs();
    fetchPipelineStatus();

    const pipelineInterval = setInterval(() => {
      fetchPipelineStatus();
    }, 60000);

    const eventSource = new EventSource('/api/admin/jobs/stream');
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'snapshot' && Array.isArray(payload.jobs)) {
          setDownloadJobs(payload.jobs);
          return;
        }
        if (payload.type === 'update' && payload.job) {
          setDownloadJobs((prev) => {
            const next = [...prev];
            const idx = next.findIndex(j => j.requestId === payload.job.requestId);
            if (idx >= 0) {
              next[idx] = payload.job;
            } else {
              next.unshift(payload.job);
            }
            return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 200);
          });
        }
      } catch (error) {
        console.error('Failed to parse job stream payload:', error);
      }
    };

    eventSource.onerror = () => {
      // Browser auto-reconnect handles transient issues.
    };

    return () => {
      clearInterval(pipelineInterval);
      eventSource.close();
    };
  }, []);

  const fetchPipelineStatus = async () => {
    try {
      const response = await fetch('/api/admin/pipeline-status');
      const result = await response.json();
      if (response.ok && result?.success) {
        setPipelineStatus(result);
      }
    } catch (error) {
      console.error('Error fetching pipeline status:', error);
    }
  };

  const fetchDownloadJobs = async () => {
    try {
      const response = await fetch('/api/admin/jobs?limit=200');
      const result = await response.json();
      if (result?.success && Array.isArray(result.jobs)) {
        setDownloadJobs(result.jobs);
      }
    } catch (error) {
      console.error('Error fetching download jobs:', error);
    }
  };

  const jobsByRequestId = useMemo(() => {
    const map = new Map();
    downloadJobs.forEach(job => {
      if (job?.requestId) map.set(job.requestId, job);
    });
    return map;
  }, [downloadJobs]);

  const liveJobs = useMemo(() => {
    const now = Date.now();
    const activeStatuses = new Set(['queued', 'downloading', 'seeding', 'processing', 'scanning']);
    const freshnessWindowMs = 2 * 60 * 60 * 1000; // 2h
    return downloadJobs
      .filter(job => {
        const updatedAt = new Date(job.updatedAt || job.createdAt || 0).getTime();
        const recentlyUpdated = Number.isFinite(updatedAt) && (now - updatedAt) < freshnessWindowMs;
        return activeStatuses.has(job.status) && recentlyUpdated;
      })
      .slice(0, 20);
  }, [downloadJobs]);

  const formatJobStage = (job) => {
    if (!job?.stage) return 'queued';
    return String(job.stage).replace(/_/g, ' ');
  };

  const formatEta = (etaSeconds) => {
    if (!Number.isFinite(Number(etaSeconds)) || etaSeconds < 0 || etaSeconds > 365 * 24 * 3600) return '—';
    const sec = Number(etaSeconds);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatSpeed = (bytesPerSec) => {
    const n = Number(bytesPerSec);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let value = n;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const pendingUsersCount = useMemo(() => users.filter(u => u.status === 'pending').length, [users]);

  const fetchUsers = async () => {
    try {
      setUsersLoading(true);
      const response = await fetch('/api/admin/users');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to fetch users');
      }
      setUsers(result.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error(error.message || 'Failed to fetch users');
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const response = await fetch('/api/telegram/status');
      const data = await response.json();
      setTelegramStatus(data);
    } catch (error) {
      console.error('Error fetching Telegram status:', error);
    }
  };

  const fetchRequests = async () => {
    try {
      const response = await fetch('/api/admin/requests');
      const data = await response.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

  const handleSearch = async (request) => {
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
      const detectSelectedFormat = (request, candidate) => {
        const text = `${candidate?.title || ''} ${candidate?.categoryName || ''}`.toLowerCase();
        const looksAudiobook = /\b(audiobook|audio\s*book|audible|m4b|mp3|aac)\b/.test(text);
        const looksEbook = /\b(e-?book|ebook|epub|pdf|mobi|azw|azw3|fb2|djvu)\b/.test(text);

        if (looksAudiobook && !looksEbook) return 'audiobook';
        if (looksEbook && !looksAudiobook) return 'ebook';

        const requested = request?.requestTypes || {};
        if (requested.audiobook && !requested.ebook) return 'audiobook';
        if (requested.ebook && !requested.audiobook) return 'ebook';
        return null;
      };

      const selectedFormat = detectSelectedFormat(activeRequest, result);

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
          selectedFormat,
          downloadInfo: result.source === 'telegram' ? {
            title: result.title,
            downloadCommand: result.downloadCommand,
            messageId: result.messageId,
            format: result.format || result.categoryName || null,
          } : null,
          categoryName: result.categoryName || null,
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

  const handleApproveUser = async (targetUser) => {
    setUserActionLoading(prev => ({ ...prev, [targetUser.googleId]: 'approve' }));
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.googleId)}/approve`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to approve user');
      }

      setUsers(prev => prev.map(u => u.googleId === targetUser.googleId ? result.user : u));

      const warning = result.absProvisioning?.warning || null;
      setUserWarnings(prev => ({ ...prev, [targetUser.googleId]: warning }));

      if (warning) {
        toast.error('User approved with ABS warning');
      } else {
        toast.success('User approved');
      }
    } catch (error) {
      console.error('Approve user error:', error);
      toast.error(error.message || 'Failed to approve user');
    } finally {
      setUserActionLoading(prev => ({ ...prev, [targetUser.googleId]: null }));
    }
  };

  const handleRejectUser = async (targetUser) => {
    setUserActionLoading(prev => ({ ...prev, [targetUser.googleId]: 'reject' }));
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUser.googleId)}/reject`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to reject user');
      }

      setUsers(prev => prev.map(u => u.googleId === targetUser.googleId ? result.user : u));
      setUserWarnings(prev => ({ ...prev, [targetUser.googleId]: null }));
      toast.success('User rejected');
    } catch (error) {
      console.error('Reject user error:', error);
      toast.error(error.message || 'Failed to reject user');
    } finally {
      setUserActionLoading(prev => ({ ...prev, [targetUser.googleId]: null }));
    }
  };

  const handleLogout = () => {
    logout();
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
        user={user}
        onAdminClick={null}
        onLogout={handleLogout}
      />

      <main className="main-content">
        <div className="admin-dashboard">
          <div className="admin-nav">
            <button className={`nav-tab ${activeTab === 'requests' ? 'active' : ''}`} onClick={() => setActiveTab('requests')}>
              <Shield size={18} />
              Requests
            </button>
            <button className={`nav-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
              <Users size={18} />
              Users {pendingUsersCount > 0 ? `(${pendingUsersCount})` : ''}
            </button>
            <Link to="/admin/imports" className="nav-tab">
              <img src="/import-log-icon.png" alt="" style={{ height: '18px', width: 'auto' }} />
              Import Log
            </Link>
            <Link to="/admin/cache" className="nav-tab">
              <Database size={18} />
              Cache
            </Link>
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

          {activeTab === 'requests' && (
            <>
              {pipelineStatus?.services && (
                <div className="pending-requests">
                  <h3>Pipeline Status</h3>
                  <div className="pipeline-status-grid">
                    {Object.entries(pipelineStatus.services).map(([key, service]) => (
                      <div key={key} className={`pipeline-status-card ${service.ok ? 'ok' : 'down'}`}>
                        <div className="pipeline-status-head">
                          <span className={`pipeline-status-dot ${service.ok ? 'ok' : 'down'}`}></span>
                          <span className="pipeline-status-label">{service.label}</span>
                        </div>
                        <div className="pipeline-status-detail">{service.detail || 'No detail available'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pending-requests">
                <h3>Live Downloads ({liveJobs.length})</h3>
                {liveJobs.length === 0 ? (
                  <p className="no-requests">No active downloads</p>
                ) : (
                  liveJobs.map((job) => (
                    <div key={job.requestId} className="request-card live-job-card">
                      <div className="request-info" style={{ flex: 1 }}>
                        <h4>{job.title || job.requestId}</h4>
                        <p>{job.author ? `by ${job.author}` : ' '}</p>
                        <div className="live-job-meta">
                          <span className={`live-job-status status-${job.status || 'queued'}`}>{job.status || 'queued'}</span>
                          <span className="live-job-stage">{formatJobStage(job)}</span>
                          {job.status === 'downloading' && (
                            <span className="live-job-throughput">
                              {formatSpeed(job.downloadSpeed)} • ETA {formatEta(job.eta)}
                            </span>
                          )}
                        </div>
                        <div className="live-job-progress-wrap">
                          <div className="live-job-progress-bar" style={{ width: `${Math.max(0, Math.min(100, Number(job.progressPct || 0)))}%` }} />
                        </div>
                        {job.events?.[0]?.message && (
                          <span className="request-time">
                            <Clock size={14} />
                            {job.events[0].message}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
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
                        {jobsByRequestId.get(request.id) && (
                          <div className="inline-job-status">
                            <span className={`live-job-status status-${jobsByRequestId.get(request.id).status || 'queued'}`}>
                              {jobsByRequestId.get(request.id).status || 'queued'}
                            </span>
                            <span className="live-job-stage">{formatJobStage(jobsByRequestId.get(request.id))}</span>
                            {jobsByRequestId.get(request.id).status === 'downloading' && (
                              <span className="live-job-throughput">
                                {Math.max(0, Math.min(100, Number(jobsByRequestId.get(request.id).progressPct || 0)))}%
                              </span>
                            )}
                          </div>
                        )}
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
            </>
          )}

          {activeTab === 'users' && (
            <div className="pending-requests">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <h3 style={{ marginBottom: 0 }}>Users ({users.length})</h3>
                <button className="search-button" onClick={fetchUsers} disabled={usersLoading}>
                  <Users size={16} />
                  {usersLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {usersLoading && users.length === 0 ? (
                <p className="no-requests">Loading users...</p>
              ) : users.length === 0 ? (
                <p className="no-requests">No users found</p>
              ) : (
                users.map((u) => {
                  const action = userActionLoading[u.googleId];
                  const warning = userWarnings[u.googleId];
                  const canApprove = u.status !== 'approved';
                  const canReject = u.status !== 'rejected';
                  return (
                    <div key={u.googleId || u.email} className="request-card" style={{ alignItems: 'flex-start' }}>
                      <div className="request-info" style={{ flex: 1 }}>
                        <h4>{u.displayName || u.username || u.email}</h4>
                        <p>{u.email}</p>
                        <div className="request-types" style={{ marginBottom: '0.5rem' }}>
                          <span className={`format-badge ${u.status === 'approved' ? 'audiobook' : u.status === 'rejected' ? 'ebook' : ''}`}>Status: {u.status}</span>
                          <span className="format-badge ebook">Role: {u.role}</span>
                        </div>
                        <div className="user-info" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span className="user-name">ABS username: {u.username || '—'}</span>
                          <span className="user-name">Kindle email: {u.kindleEmail || '—'}</span>
                          <span className="request-time">
                            <Clock size={14} /> Joined: {u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}
                          </span>
                          {u.approvedAt && (
                            <span className="request-time">
                              <Clock size={14} /> Approved: {new Date(u.approvedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {warning && (
                          <div style={{ marginTop: '0.75rem', color: '#fbbf24', fontSize: '0.9rem' }}>
                            ⚠ {warning}
                          </div>
                        )}
                      </div>
                      <div className="request-actions" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: '150px' }}>
                        <button
                          onClick={() => handleApproveUser(u)}
                          disabled={!canApprove || Boolean(action)}
                          className="search-button"
                          style={{ justifyContent: 'center' }}
                        >
                          <Check size={16} /> {action === 'approve' ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleRejectUser(u)}
                          disabled={!canReject || Boolean(action)}
                          className="search-button"
                          style={{ justifyContent: 'center', background: '#4b1d1d' }}
                        >
                          <Ban size={16} /> {action === 'reject' ? 'Rejecting...' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {loading && (
            <div className="loading-overlay">
              <div className="loading-spinner"></div>
              <p>Processing...</p>
            </div>
          )}
        </div>
      </main>
      {renderTelegramAuthModal()}
    </div>
  );
};

export default AdminDashboard;
