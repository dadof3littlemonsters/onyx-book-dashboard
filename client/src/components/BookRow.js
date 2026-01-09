import React, { useState, useEffect } from 'react';
import './BookRow.css';

const BookRow = ({ category, books, onBookSelect }) => {
  const getCoverSrc = (cover) => {
    if (!cover) return null;
    // If server already returns a proxied path, keep it
    if (typeof cover === 'string' && cover.startsWith('/api/proxy')) return cover;
    // Only proxy remote URLs (Hardcover hotlink protection)
    if (typeof cover === 'string' && cover.startsWith('http')) {
      return `/api/proxy-image?url=${encodeURIComponent(cover)}`;
    }
    return cover;
  };

  const getInitials = (title) => {
    const t = (title || '').trim();
    if (!t) return '📚';
    const words = t.split(/\s+/).slice(0, 2);
    return words.map(w => w[0]?.toUpperCase()).join('');
  };

  const [rowBooks, setRowBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (books) {
      setRowBooks(books);
      setLoading(false);
    } else if (category) {
      fetch(`/api/books/${category}`)
        .then(res => res.json())
        .then(data => {
          setRowBooks(data);
          setLoading(false);
        })
        .catch(err => {
          console.error('Error fetching books:', err);
          setLoading(false);
        });
    }
  }, [category, books]);

  if (loading) {
    return (
      <div className="book-row">
        <div className="loading">Loading books...</div>
      </div>
    );
  }

  return (
    <div className="book-row">
      <div className="book-scroll-container">
        {rowBooks.map((book) => (
          <div
            key={book.id}
            className="book-card"
            onClick={() => onBookSelect(book)}
          >
            <div className="book-cover">
              {getCoverSrc(book.cover) ? (
                <img src={getCoverSrc(book.cover)} alt={book.title} loading="lazy" />
              ) : (
                <div className="book-cover-placeholder" aria-label={book.title}>
                  {getInitials(book.title)}
                </div>
              )}
              {book.libraryStatus && (
                <div className="library-badge" data-status={book.libraryStatus}>
                  {book.libraryStatus === 'owned' ? '✓' : ''}
                </div>
              )}
              <div className="book-overlay">
                {book.rating ? <div className="book-rating">★ {book.rating}</div> : null}
              </div>
            </div>
            <div className="book-info">
              <h3 className="book-title">{book.title}</h3>
              <p className="book-author">{book.author}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookRow;