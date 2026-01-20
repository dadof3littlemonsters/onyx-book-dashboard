import React, { useState, useEffect } from 'react';
import { FileCheck, AlertCircle, HardDrive, Trash2 } from 'lucide-react';
import './AdminPanel.css';

const ImportLog = () => {
    const [imports, setImports] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, success, failed

    useEffect(() => {
        fetchImports();
        fetchStats();
    }, []);

    const fetchImports = async () => {
        try {
            const response = await fetch('/api/admin/import-log');
            const data = await response.json();
            setImports(data);
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
            alert('Failed to cleanup import log');
        }
    };

    const filteredImports = imports.filter(imp => {
        if (filter === 'all') return true;
        if (filter === 'success') return imp.status === 'success';
        if (filter === 'failed') return imp.status === 'failed' || imp.status === 'partial';
        return true;
    });

    const getStatusBadge = (status) => {
        const colors = {
            success: '#10b981',
            failed: '#ef4444',
            partial: '#f59e0b'
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
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default ImportLog;
