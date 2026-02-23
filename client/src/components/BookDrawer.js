import React, { useState, useEffect, useRef } from 'react';
import { X, Star, BookOpen, Download, Headphones, Book } from 'lucide-react';
import toast from 'react-hot-toast';
import './BookDrawer.css';

const BookDrawer = ({ book, isOpen, onClose, onRequest }) => {
  const [requestAudiobook, setRequestAudiobook] = useState(false);
  const [requestEbook, setRequestEbook] = useState(false);
  const [coverImgErrored, setCoverImgErrored] = useState(false);
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);

  // ESC key handler
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      setCoverImgErrored(false);
      // Save current focus
      previousFocusRef.current = document.activeElement;
      // Focus first interactive element in drawer after animation
      setTimeout(() => {
        const focusable = drawerRef.current?.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        focusable?.focus();
      }, 100);
    } else {
      // Restore focus when closing
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen || !book) return null;

  const getCoverSrc = (bookData, options = {}) => {
    const params = new URLSearchParams();
    const rawCover = options.placeholderOnly ? null : (bookData?.cover || bookData?.coverUrl || bookData?.thumbnail || null);

    if (typeof rawCover === 'string' && rawCover.startsWith('/api/cover')) {
      return rawCover;
    }

    let cover = rawCover;
    if (typeof rawCover === 'string' && rawCover.startsWith('/api/proxy-image')) {
      const qs = rawCover.split('?')[1] || '';
      const upstreamFromProxy = new URLSearchParams(qs).get('url');
      cover = upstreamFromProxy || null;
    }

    if (cover && typeof cover === 'string' && /^https?:\/\//i.test(cover)) {
      params.set('url', cover);
    }
    if (bookData?.title) {
      params.set('title', bookData.title);
    }
    if (bookData?.isbn13) {
      params.set('isbn13', bookData.isbn13);
    }
    if (bookData?.isbn) {
      params.set('isbn', bookData.isbn);
    }
    if (bookData?.goodreadsCoverUrl) {
      params.set('goodreadsUrl', bookData.goodreadsCoverUrl);
    }

    return `/api/cover?${params.toString()}`;
  };

  const handleRequest = () => {
    if (!requestAudiobook && !requestEbook) {
      toast.error('Please select at least one format (Audiobook or Ebook)');
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
    <div
      className={`drawer-overlay ${isOpen ? 'open' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-title"
    >
      <div ref={drawerRef} className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <button className="close-button" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="book-details">
            <div className="book-cover-large">
              <img
                src={getCoverSrc(book, { placeholderOnly: coverImgErrored })}
                alt={book.title}
                onError={() => setCoverImgErrored(true)}
              />
            </div>

            <div className="book-meta">
              <h1 id="book-title" className="book-title-large">{book.title}</h1>
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

              {/* Book metadata */}
              {(book.isbn || book.isbn13 || book.publisher || book.publishedDate || book.publishDate) && (
                <div className="book-metadata">
                  {book.isbn && (
                    <div className="book-meta-item">
                      <span className="meta-label">ISBN:</span>
                      <span>{book.isbn}</span>
                    </div>
                  )}
                  {book.isbn13 && book.isbn13 !== book.isbn && (
                    <div className="book-meta-item">
                      <span className="meta-label">ISBN-13:</span>
                      <span>{book.isbn13}</span>
                    </div>
                  )}
                  {book.publisher && (
                    <div className="book-meta-item">
                      <span className="meta-label">Publisher:</span>
                      <span>{book.publisher}</span>
                    </div>
                  )}
                  {book.publishedDate && (
                    <div className="book-meta-item">
                      <span className="meta-label">Published:</span>
                      <span>{new Date(book.publishedDate).getFullYear()}</span>
                    </div>
                  )}
                  {book.publishDate && !book.publishedDate && (
                    <div className="book-meta-item">
                      <span className="meta-label">Published:</span>
                      <span>{new Date(book.publishDate).getFullYear()}</span>
                    </div>
                  )}
                </div>
              )}

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

                    <button
                      className="request-button request-both"
                      onClick={() => {
                        onRequest(book.id, {
                          title: book.title,
                          author: book.author,
                          requestTypes: {
                            audiobook: true,
                            ebook: true
                          }
                        });
                      }}
                    >
                      <Download size={20} />
                      Request Both
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