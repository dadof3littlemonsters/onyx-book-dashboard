import React, { useState } from 'react';
import { X, Star, BookOpen, Download, Headphones, Book } from 'lucide-react';
import './BookDrawer.css';

const BookDrawer = ({ book, isOpen, onClose, onRequest }) => {
  const [requestAudiobook, setRequestAudiobook] = useState(false);
  const [requestEbook, setRequestEbook] = useState(false);

  if (!isOpen || !book) return null;

  const getCoverSrc = (cover) => {
    if (!cover) return null;
    // If server already returns a proxied path, keep it
    if (typeof cover === 'string' && cover.startsWith('/api/proxy')) return cover;
    // Google Books images don't need proxying (CORS friendly)
    if (typeof cover === 'string' && cover.includes('books.google.com')) {
      return cover;
    }
    // Only proxy other remote URLs (Hardcover hotlink protection)
    if (typeof cover === 'string' && cover.startsWith('http')) {
      return `/api/proxy-image?url=${encodeURIComponent(cover)}`;
    }
    return cover;
  };

  const handleRequest = () => {
    if (!requestAudiobook && !requestEbook) {
      alert('Please select at least one format (Audiobook or Ebook)');
      return;
    }

    onRequest(book.id, {
      title: book.title,
      author: book.author,
      requestTypes: {
        audiobook: requestAudiobook,
        ebook: requestEbook
      }
    });
  };

  return (
    <div className={`drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <button className="close-button" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="book-details">
            <div className="book-cover-large">
              {getCoverSrc(book.cover || book.coverUrl || book.thumbnail) ? (
                <img src={getCoverSrc(book.cover || book.coverUrl || book.thumbnail)} alt={book.title} />
              ) : (
                <div className="book-cover-placeholder" style={{
                  width: '100%',
                  height: '300px',
                  backgroundColor: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  fontWeight: 'bold',
                  color: '#666'
                }}>
                  {book.title?.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '📚'}
                </div>
              )}
            </div>

            <div className="book-meta">
              <h1 className="book-title-large">{book.title}</h1>
              <p className="book-author-large">by {book.author}</p>

              <div className="book-stats">
                <div className="stat">
                  <Star className="stat-icon" size={16} fill="currentColor" />
                  <span>{book.rating}</span>
                </div>
                <div className="stat">
                  <BookOpen className="stat-icon" size={16} />
                  <span>{book.pages} pages</span>
                </div>
              </div>

              <div className="book-synopsis">
                <h3>Synopsis</h3>
                <p>{book.synopsis}</p>
              </div>

              <div className="book-actions">
                {book.libraryStatus === 'owned' ? (
                  <div className="library-status owned">
                    <span className="status-icon">✓</span>
                    In Library
                  </div>
                ) : (
                  <div className="request-section">
                    <h3>Request Options</h3>
                    <div className="format-toggles">
                      <label className={`format-toggle ${requestAudiobook ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={requestAudiobook}
                          onChange={(e) => setRequestAudiobook(e.target.checked)}
                        />
                        <div className="toggle-content">
                          <Headphones size={20} />
                          <span>Request Audiobook</span>
                        </div>
                      </label>

                      <label className={`format-toggle ${requestEbook ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={requestEbook}
                          onChange={(e) => setRequestEbook(e.target.checked)}
                        />
                        <div className="toggle-content">
                          <Book size={20} />
                          <span>Request Ebook</span>
                        </div>
                      </label>
                    </div>

                    <button
                      className={`request-button ${(!requestAudiobook && !requestEbook) ? 'disabled' : ''}`}
                      onClick={handleRequest}
                      disabled={!requestAudiobook && !requestEbook}
                    >
                      <Download size={20} />
                      Submit Request
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDrawer;