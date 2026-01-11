import React, { useState, useEffect } from 'react';
import { Search, User, LogOut, Menu, Settings } from 'lucide-react';
import BookRow from './BookRow';
import BookDrawer from './BookDrawer';
import UserSelector from './UserSelector';
import '../App.css';

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isUserSelectorOpen, setIsUserSelectorOpen] = useState(false);
  const [isBurgerMenuOpen, setIsBurgerMenuOpen] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
          .then(res => res.json())
          .then(data => setSearchResults(data))
          .catch(err => console.error('Search error:', err));
      } else {
        setSearchResults([]);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    // Check for previously selected user in localStorage (support multiple key formats)
    const savedUser = localStorage.getItem('onyx-selected-user') || localStorage.getItem('onyx_user');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setSelectedUser(userData);
        console.log('[DEBUG] Found saved user:', userData.username);
      } catch (err) {
        console.error('Error parsing saved user data:', err);
        localStorage.removeItem('onyx-selected-user');
        localStorage.removeItem('onyx_user');
        setIsUserSelectorOpen(true); // Force modal if corrupted data
      }
    } else {
      // No user selected - force identity modal to appear immediately
      console.log('[DEBUG] No user found in localStorage, forcing identity modal');
      setIsUserSelectorOpen(true);
    }
  }, []);

  // Close burger menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isBurgerMenuOpen && !event.target.closest('.burger-menu-container')) {
        setIsBurgerMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isBurgerMenuOpen]);

  const handleBookSelect = (book) => {
    setSelectedBook(book);
    setIsDrawerOpen(true);
  };

  const handleBookRequest = async (bookId, requestData) => {
    // Check if user is selected, prompt selection if not
    if (!selectedUser) {
      setIsUserSelectorOpen(true);
      return;
    }

    try {
      const response = await fetch(`/api/request/${bookId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: requestData?.title || selectedBook?.title || 'Unknown Title',
          author: requestData?.author || selectedBook?.author || 'Unknown Author',
          requestTypes: requestData?.requestTypes || {
            audiobook: false,
            ebook: true
          },
          userId: selectedUser.id,
          userEmail: selectedUser.email,
          username: selectedUser.username
        })
      });

      const result = await response.json();

      if (result.success) {
        const requestTypes = [];
        if (requestData?.requestTypes?.audiobook) requestTypes.push('audiobook');
        if (requestData?.requestTypes?.ebook) requestTypes.push('ebook');
        const formatText = requestTypes.join(' and ');

        alert(`${formatText} request submitted successfully! An admin will review your request.`);
        setIsDrawerOpen(false);
      } else {
        alert('Failed to submit book request');
      }
    } catch (error) {
      console.error('Request error:', error);
      alert('Error submitting book request');
    }
  };

  const handleUserSelection = (user) => {
    setSelectedUser(user);
    // If there was a pending book request, process it now
    if (selectedBook) {
      // We don't automatically submit here, let user click request again
    }
  };

  const handleChangeUser = () => {
    setIsUserSelectorOpen(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('onyx-selected-user');
    localStorage.removeItem('onyx-has-visited');
    setSelectedUser(null);
    setIsUserSelectorOpen(true);
    setIsBurgerMenuOpen(false);
  };

  const handleLogoClick = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedBook(null);
    setIsDrawerOpen(false);
    setIsBurgerMenuOpen(false);
  };

  const handleBurgerMenuToggle = () => {
    setIsBurgerMenuOpen(!isBurgerMenuOpen);
  };

  const closeBurgerMenu = () => {
    setIsBurgerMenuOpen(false);
  };

  const handleAdminClick = () => {
    window.location.href = '/admin';
    setIsBurgerMenuOpen(false);
  };

  const categories = [
    { name: 'Romantasy', key: 'romantasy' },
    { name: 'Fantasy', key: 'fantasy' },
    { name: 'Dystopian', key: 'dystopian' },
    { name: 'Cozy', key: 'cozy' }
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="logo" onClick={handleLogoClick}>ONYX</h1>

          <div className="search-container-centered">
            <Search className="search-icon" size={20} />
            <input
              type="text"
              placeholder="Search for books..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {selectedUser ? (
            <div className="header-right">
              <span className="username">{selectedUser.username}</span>
              <div className="burger-menu-container">
                <button onClick={handleBurgerMenuToggle} className="burger-menu-button">
                  <Menu size={20} />
                </button>
                {isBurgerMenuOpen && (
                  <>
                    <div className="burger-menu-overlay" onClick={closeBurgerMenu}></div>
                    <div className="burger-menu">
                      <button onClick={handleChangeUser} className="burger-menu-item">
                        <User size={18} />
                        <span>Switch User</span>
                      </button>
                      <button onClick={handleLogout} className="burger-menu-item">
                        <LogOut size={18} />
                        <span>Logout</span>
                      </button>
                      {selectedUser.username.toLowerCase() === 'craig' && (
                        <button onClick={handleAdminClick} className="burger-menu-item">
                          <Settings size={18} />
                          <span>Admin</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="header-right">
              <button onClick={() => setIsUserSelectorOpen(true)} className="select-user-button">
                <User size={18} />
                <span>Who are you?</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {searchQuery.trim() && (
          <div className="search-results">
            <h2>Search Results</h2>
            {searchResults.length > 0 ? (
              <BookRow
                books={searchResults}
                onBookSelect={handleBookSelect}
              />
            ) : (
              <p className="no-results">No books found</p>
            )}
          </div>
        )}

        {!searchQuery.trim() && (
          <div className="book-categories">
            {categories.map((category) => (
              <div key={category.key} className="category-section">
                <h2 className="category-title">{category.name}</h2>
                <BookRow
                  category={category.key}
                  onBookSelect={handleBookSelect}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <BookDrawer
        book={selectedBook}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onRequest={handleBookRequest}
      />

      <UserSelector
        isOpen={isUserSelectorOpen}
        onClose={() => setIsUserSelectorOpen(false)}
        onSelectUser={handleUserSelection}
      />
    </div>
  );
};

export default HomePage;