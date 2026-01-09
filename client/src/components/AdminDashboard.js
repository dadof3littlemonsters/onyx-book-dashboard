import React, { useState, useEffect } from 'react';
import { Shield, Search, Download, Clock, X } from 'lucide-react';
import './AdminPanel.css';

const AdminDashboard = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [requests, setRequests] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      fetchRequests();
    }
  }, [isAuthenticated]);

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
        alert('Invalid PIN');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed');
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
    if (!searchQuery.trim()) {
      alert('Please enter a search query');
      return;
    }

    setLoading(true);
    setActiveRequest(request);

    try {
      const response = await fetch(`/api/admin/search/${request.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: searchQuery }),
      });

      const result = await response.json();

      if (result.success) {
        setSearchResults(result.results);
      } else {
        alert('Search failed: ' + result.message);
      }
    } catch (error) {
      console.error('Search error:', error);
      alert('Search failed');
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
        }),
      });

      const downloadResult = await response.json();

      if (downloadResult.success) {
        alert('Download started successfully!');
        setSearchResults([]);
        setActiveRequest(null);
        fetchRequests();
      } else {
        alert('Download failed: ' + downloadResult.message);
      }
    } catch (error) {
      console.error('Download error:', error);
      alert('Download failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-overlay">
      <div className="admin-panel">
        <div className="admin-header">
          <div className="admin-title">
            <Shield size={24} />
            <h2>Admin Dashboard</h2>
          </div>
          <button className="close-button" onClick={() => window.history.back()}>
            <X size={24} />
          </button>
        </div>

        <div className="admin-content">
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
                          <h4>{result.title}</h4>
                          <div className="result-details">
                            <span className="result-size">{result.formattedSize}</span>
                            <span className="result-seeders">Seeders: {result.seeders}</span>
                            <span className="result-tracker">{result.tracker}</span>
                            <span className="result-category">{result.categoryName}</span>
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
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;