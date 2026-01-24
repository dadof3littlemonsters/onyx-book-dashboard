import React, { useState, useEffect } from 'react';
import { Search, User, LogOut, Menu, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import BookRow from './BookRow';
import BookDrawer from './BookDrawer';
import UserSelector from './UserSelector';
import Header from './Header';
import '../App.css';

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isUserSelectorOpen, setIsUserSelectorOpen] = useState(false);
  const [isBurgerMenuOpen, setIsBurgerMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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

  // Check admin status from server
  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await fetch('/api/user/is-admin');
        if (response.ok) {
          const data = await response.json();
          setIsAdmin(data.isAdmin);
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Failed to check admin status:', error);
        setIsAdmin(false);
      }
    };

    if (selectedUser) {
      checkAdminStatus();
    } else {
      setIsAdmin(false);
    }
  }, [selectedUser]);

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

        toast.success(`${formatText} request submitted successfully! An admin will review your request.`);
        setIsDrawerOpen(false);
      } else {
        toast.error('Failed to submit book request');
      }
    } catch (error) {
      console.error('Request error:', error);
      toast.error('Error submitting book request');
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

  const handleCategoryClick = (categoryKey, categoryName) => {
    // Fetch all books in category and show in expanded view
    fetch(`/api/books/${categoryKey}`)
      .then(res => res.json())
      .then(data => {
        setSearchResults(data);
        setSearchQuery(`Category: ${categoryName}`);
      })
      .catch(err => console.error('Category fetch error:', err));
  };

  const categories = [
    { name: 'Romantasy', key: 'romantasy' },
    { name: 'Fantasy & High Fantasy', key: 'fantasy' },
    { name: 'BookTok Trending', key: 'booktok_trending' },
    { name: 'Popular Right Now', key: 'popular' },
    { name: 'New This Month', key: 'new_releases' },
    { name: 'Hidden Gems', key: 'hidden_gems' },
    { name: 'Action & Adventure', key: 'action_adventure' },
    { name: 'Science Fiction', key: 'scifi' },
    { name: 'Dark Fantasy', key: 'dark_fantasy' },
    { name: 'Enemies to Lovers', key: 'enemies_to_lovers' },
    { name: 'Dragons & Magic', key: 'dragons' },
    { name: 'Coming Soon: Personalized recommendations based on your requests', key: 'personalized' }
  ];

  return (
    <div className="app">
      <Header
        showSearch={true}
        selectedUser={selectedUser}
        onUserChange={() => setIsUserSelectorOpen(true)}
        onAdminClick={isAdmin ? handleAdminClick : null}
        onLogout={handleLogout}
        onLogoClick={handleLogoClick}
        isBurgerMenuOpen={isBurgerMenuOpen}
        onBurgerMenuToggle={handleBurgerMenuToggle}
        closeBurgerMenu={closeBurgerMenu}
        searchQuery={searchQuery}
        onSearchChange={(e) => setSearchQuery(e.target.value)}
      />

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
                <h2
                  className="category-title"
                  onClick={() => handleCategoryClick(category.key, category.name)}
                >
                  {category.name}
                  <span className="view-all-link">View All →</span>
                </h2>
                {category.key === 'personalized' ? (
                  <div className="personalized-placeholder">
                    <p>Coming Soon: Personalized recommendations based on your requests</p>
                  </div>
                ) : (
                  <BookRow
                    category={category.key}
                    onBookSelect={handleBookSelect}
                  />
                )}
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