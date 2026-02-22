import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './BookRow.css';

const BookRow = ({ category, books, onBookSelect }) => {
  const scrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const getCoverSrc = (cover) => {
    if (!cover) return null;
    // If server already returns a proxied path, keep it
    if (typeof cover === 'string' && cover.startsWith('/api/proxy')) return cover;
    // Google Books images don't need proxying (CORS friendly)
    if (typeof cover === 'string' && cover.includes('books.google.com')) {
      return cover;
    }
    // Hardcover assets need proxying (hotlink protection)
    if (typeof cover === 'string' && cover.includes('hardcover.app')) {
      return `/api/proxy-image?url=${encodeURIComponent(cover)}`;
    }
    // Goodreads CDN blocks direct hotlinking from browsers — proxy via server
    if (typeof cover === 'string' && (cover.includes('images.gr-assets.com') || cover.includes('i.gr-assets.com'))) {
      return `/api/proxy-image?url=${encodeURIComponent(cover)}`;
    }
    // For other http URLs, try direct first (browser will handle CORS)
    if (typeof cover === 'string' && cover.startsWith('http')) {
      return cover;
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
  const [imgErrors, setImgErrors] = useState({});

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

  // Update arrow visibility based on scroll position
  const updateArrows = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updateArrows);
      // Initial check
      setTimeout(updateArrows, 100);
      return () => scrollContainer.removeEventListener('scroll', updateArrows);
    }
  }, [rowBooks]);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  const handleImgError = (bookId) => {
    setImgErrors(prev => ({ ...prev, [bookId]: true }));
  };

  if (loading) {
    return (
      <div className="book-row">
        <div className="loading-skeleton">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="book-row">
      {showLeftArrow && (
        <button className="scroll-arrow scroll-arrow-left" onClick={() => scroll('left')} aria-label="Scroll left">
          <ChevronLeft size={28} />
        </button>
      )}
      <div className="book-scroll-container" ref={scrollRef}>
        {rowBooks.map((book) => {
          const coverSrc = getCoverSrc(book.coverUrl || book.thumbnail);
          const hasError = imgErrors[book.id];

          return (
            <div
              key={book.id}
              className="book-card"
              onClick={() => onBookSelect(book)}
            >
              <div className="book-cover">
                {coverSrc && !hasError ? (
                  <img
                    src={coverSrc}
                    alt={book.title}
                    loading="lazy"
                    onError={() => handleImgError(book.id)}
                  />
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
          );
        })}
      </div>
      {showRightArrow && (
        <button className="scroll-arrow scroll-arrow-right" onClick={() => scroll('right')} aria-label="Scroll right">
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  );
};

export default BookRow;