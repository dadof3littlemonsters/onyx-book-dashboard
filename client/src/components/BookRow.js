import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './BookRow.css';

const BookRow = ({ category, books, onBookSelect }) => {
  const scrollRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const getCoverSrc = (book, options = {}) => {
    const params = new URLSearchParams();
    const rawCover = options.placeholderOnly ? null : (book?.coverUrl || book?.thumbnail || book?.cover || null);

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
    if (book?.title) {
      params.set('title', book.title);
    }
    if (book?.isbn13) {
      params.set('isbn13', book.isbn13);
    }
    if (book?.isbn) {
      params.set('isbn', book.isbn);
    }
    if (book?.goodreadsCoverUrl) {
      params.set('goodreadsUrl', book.goodreadsCoverUrl);
    }

    return `/api/cover?${params.toString()}`;
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
          const coverSrc = getCoverSrc(book, { placeholderOnly: !!imgErrors[book.id] });

          return (
            <div
              key={book.id}
              className="book-card"
              onClick={() => onBookSelect(book)}
            >
              <div className="book-cover">
                <img
                  src={coverSrc}
                  alt={book.title}
                  loading="lazy"
                  onError={() => handleImgError(book.id)}
                />
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