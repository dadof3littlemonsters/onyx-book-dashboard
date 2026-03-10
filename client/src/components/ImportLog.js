import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FileCheck, AlertCircle, HardDrive, Trash2, Shield, Database, ClipboardCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Header from './Header';
import { useAuth } from '../context/AuthContext';
import './AdminPanel.css';

const ImportLog = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [imports, setImports] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, success, failed
    const [reviewDrafts, setReviewDrafts] = useState({});
    const [submittingId, setSubmittingId] = useState(null);

    useEffect(() => {
        fetchImports();
        fetchStats();
    }, []);

    const fetchImports = async () => {
        try {
            const response = await fetch('/api/admin/import-log');
            const data = await response.json();
            setImports(data);
            setReviewDrafts((prev) => {
                const next = { ...prev };
                data.forEach((imp) => {
                    if (!next[imp.id]) {
                        next[imp.id] = {
                            author: imp.review?.author || '',
                            title: imp.review?.title || imp.torrentName || '',
                            series: imp.review?.series || ''
                        };
                    }
                });
                return next;
            });
            setLoading(false);
        } catch (error) {
            console.error('Error fetching imports:', error);
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await fetch('/api/admin/import-log/stats');
            const data = await response.json();
            setStats(data);
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    const handleCleanup = async () => {
        if (!window.confirm('Clear imports older than 30 days?')) return;

        try {
            await fetch('/api/admin/import-log/cleanup', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: 30 })
            });
            fetchImports();
            fetchStats();
        } catch (error) {
            console.error('Error cleaning up:', error);
            toast.error('Failed to cleanup import log');
        }
    };

    const filteredImports = imports.filter(imp => {
        if (filter === 'all') return true;
        if (filter === 'success') return imp.status === 'success';
        if (filter === 'failed') return imp.status === 'failed' || imp.status === 'partial';
        if (filter === 'review') return imp.status === 'manual_review_required' || imp.status === 'review_processing' || imp.status === 'review_completed';
        return true;
    });

    const handleDraftChange = (id, field, value) => {
        setReviewDrafts((prev) => ({
            ...prev,
            [id]: {
                ...(prev[id] || {}),
                [field]: value
            }
        }));
    };

    const handleReviewSubmit = async (imp) => {
        const draft = reviewDrafts[imp.id] || {};
        if (!draft.author?.trim() || !draft.title?.trim()) {
            toast.error('Author and title are required');
            return;
        }

        try {
            setSubmittingId(imp.id);
            const response = await fetch(`/api/admin/import-log/${imp.id}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    author: draft.author.trim(),
                    title: draft.title.trim(),
                    series: draft.series?.trim() || ''
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Manual review failed');
            }
            toast.success('Manual review import started');
            fetchImports();
            fetchStats();
        } catch (error) {
            console.error('Error submitting manual review:', error);
            toast.error(error.message || 'Failed to submit manual review');
        } finally {
            setSubmittingId(null);
        }
    };

    const getStatusBadge = (status) => {
        const colors = {
            success: '#10b981',
            failed: '#ef4444',
            partial: '#f59e0b',
            manual_review_required: '#ef4444',
            review_processing: '#2563eb',
            review_completed: '#10b981'
        };
        return (
            <span style={{
                background: colors[status] || '#666',
                color: 'white',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '600',
                textTransform: 'uppercase'
            }}>
                {status}
            </span>
        );
    };

    const getOperationBadge = (operation) => {
        return (
            <span style={{
                background: operation === 'hardlink' ? '#3b82f6' : '#8b5cf6',
                color: 'white',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '600'
            }}>
                {operation === 'hardlink' ? '🔗 MAM' : '📦 Move'}
            </span>
        );
    };

    return (
        <div className="app">
            <Header
                showSearch={false}
                user={user}
                onAdminClick={() => navigate('/admin')}
                onLogout={logout}
                onLogoClick={() => navigate('/')}
            />

            <main className="admin-main">
                <div className="admin-nav">
                    <Link to="/admin" className="nav-tab">
                        <Shield size={18} />
                        Requests
                    </Link>
                    <Link to="/admin/imports" className="nav-tab active">
                        <img src="/import-log-icon.png" alt="" style={{ height: '18px', width: 'auto' }} />
                        Import Log
                    </Link>
                    <Link to="/admin/cache" className="nav-tab">
                        <Database size={18} />
                        Cache
                    </Link>
                </div>
                <div className="import-log-container">
                    <div className="import-log-header">
                        <h2>Import Log</h2>
                        <button onClick={handleCleanup} className="cleanup-button">
                            <Trash2 size={16} />
                            Cleanup Old
                        </button>
                    </div>

                    {stats && (
                        <div className="import-stats">
                            <div className="stat-card">
                                <FileCheck size={24} />
                                <div>
                                    <div className="stat-value">{stats.total}</div>
                                    <div className="stat-label">Total Imports</div>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div style={{ color: '#10b981' }}>✓</div>
                                <div>
                                    <div className="stat-value">{stats.successful}</div>
                                    <div className="stat-label">Successful</div>
                                </div>
                            </div>
                            <div className="stat-card">
                                <AlertCircle size={24} color="#ef4444" />
                                <div>
                                    <div className="stat-value">{stats.failed}</div>
                                    <div className="stat-label">Failed</div>
                                </div>
                            </div>
                            <div className="stat-card">
                                <ClipboardCheck size={24} color="#f59e0b" />
                                <div>
                                    <div className="stat-value">{stats.manualReview || 0}</div>
                                    <div className="stat-label">Needs Review</div>
                                </div>
                            </div>
                            <div className="stat-card">
                                <HardDrive size={24} color="#3b82f6" />
                                <div>
                                    <div className="stat-value">{stats.mamImports}</div>
                                    <div className="stat-label">MAM Hardlinks</div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="import-filters">
                        <button
                            className={filter === 'all' ? 'filter-active' : ''}
                            onClick={() => setFilter('all')}
                        >
                            All
                        </button>
                        <button
                            className={filter === 'success' ? 'filter-active' : ''}
                            onClick={() => setFilter('success')}
                        >
                            Success
                        </button>
                        <button
                            className={filter === 'failed' ? 'filter-active' : ''}
                            onClick={() => setFilter('failed')}
                        >
                            Failed
                        </button>
                        <button
                            className={filter === 'review' ? 'filter-active' : ''}
                            onClick={() => setFilter('review')}
                        >
                            Review
                        </button>
                    </div>

                    {loading ? (
                        <div className="loading-spinner"></div>
                    ) : (
                        <div className="import-list">
                            {filteredImports.length === 0 ? (
                                <p className="no-imports">No imports found</p>
                            ) : (
                                filteredImports.map((imp) => (
                                    <div key={imp.id} className="import-card">
                                        <div className="import-header">
                                            <h4>{imp.torrentName}</h4>
                                            <div className="import-badges">
                                                {getOperationBadge(imp.operation)}
                                                {getStatusBadge(imp.status)}
                                            </div>
                                        </div>
                                        <div className="import-details">
                                            <div className="import-info">
                                                <span className="import-label">Media:</span>
                                                <span>{imp.mediaType}</span>
                                            </div>
                                            <div className="import-info">
                                                <span className="import-label">Processed:</span>
                                                <span>{imp.filesProcessed} files</span>
                                            </div>
                                            <div className="import-info">
                                                <span className="import-label">Skipped:</span>
                                                <span>{imp.filesSkipped} files</span>
                                            </div>
                                            <div className="import-info">
                                                <span className="import-label">Time:</span>
                                                <span>{new Date(imp.timestamp).toLocaleString()}</span>
                                            </div>
                                        </div>
                                        {imp.errors && imp.errors.length > 0 && (
                                            <div className="import-errors">
                                                <strong>Errors:</strong>
                                                {imp.errors.map((err, idx) => (
                                                    <div key={idx} className="error-item">
                                                        {err.file}: {err.error}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {(imp.status === 'manual_review_required' || imp.status === 'review_processing' || imp.status === 'review_completed') && (
                                            <div className="manual-review-panel">
                                                <strong>Manual Review</strong>
                                                <div className="manual-review-grid">
                                                    <input
                                                        type="text"
                                                        placeholder="Author"
                                                        value={reviewDrafts[imp.id]?.author || ''}
                                                        onChange={(e) => handleDraftChange(imp.id, 'author', e.target.value)}
                                                        disabled={imp.status === 'review_processing' || submittingId === imp.id}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Title"
                                                        value={reviewDrafts[imp.id]?.title || ''}
                                                        onChange={(e) => handleDraftChange(imp.id, 'title', e.target.value)}
                                                        disabled={imp.status === 'review_processing' || submittingId === imp.id}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Series (optional)"
                                                        value={reviewDrafts[imp.id]?.series || ''}
                                                        onChange={(e) => handleDraftChange(imp.id, 'series', e.target.value)}
                                                        disabled={imp.status === 'review_processing' || submittingId === imp.id}
                                                    />
                                                </div>
                                                <div className="manual-review-actions">
                                                    <button
                                                        className="search-button"
                                                        onClick={() => handleReviewSubmit(imp)}
                                                        disabled={imp.status === 'review_processing' || submittingId === imp.id}
                                                    >
                                                        {imp.status === 'review_processing' || submittingId === imp.id ? 'Processing…' : 'Import With Review'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default ImportLog;
