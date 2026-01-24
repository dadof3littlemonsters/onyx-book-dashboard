import React, { useState, useEffect } from 'react';
import { Shield, Search, Download, Clock, CheckCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import './AdminPanel.css';

const AdminPanel = ({ isOpen, onClose }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [requests, setRequests] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      fetchRequests();
    }
  }, [isOpen, isAuthenticated]);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/admin/login', {
        credentials: 'include',
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
      const response = await fetch('/api/admin/requests', { credentials: 'include' });
      const data = await response.json();
      setRequests(data);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

  const handleSearch = async (request) => {
    if (!searchQuery.trim()) {
      toast.error('Please enter a search query');
      return;
    }

    setLoading(true);
    setActiveRequest(request);

    try {
      const response = await fetch(`/api/admin/search/${request.id}`, {
        credentials: 'include',
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
        credentials: 'include',
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

  if (!isOpen) return null;

  return (
    <div className="admin-overlay">
      <div className="admin-panel">
        <div className="admin-header">
          <div className="admin-title">
            <Shield size={24} />
            <h2>Admin Panel</h2>
          </div>
          <button className="close-button" onClick={onClose}>
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
                        <span className="request-time">
                          <Clock size={14} />
                          {new Date(request.createdAt).toLocaleString()}
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

export default AdminPanel;