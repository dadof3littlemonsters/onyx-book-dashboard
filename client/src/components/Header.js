import React, { useState, useEffect } from 'react';
import { Search, Menu, Settings, LogOut, User } from 'lucide-react';
import '../App.css';

const Header = ({
    showSearch = true,
    selectedUser,
    onUserChange,
    onAdminClick,
    onLogout,
    searchQuery = '',
    onSearchChange
}) => {
    const [isBurgerMenuOpen, setIsBurgerMenuOpen] = useState(false);

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

    const handleBurgerMenuToggle = () => {
        setIsBurgerMenuOpen(!isBurgerMenuOpen);
    };

    const closeBurgerMenu = () => {
        setIsBurgerMenuOpen(false);
    };

    const handleLogoClick = () => {
        window.location.href = '/';
    };

    return (
        <header className="header">
            <div className="header-content">
                <div className="logo" onClick={handleLogoClick}>
                    <img src="/logo.png" alt="Onyx" className="logo-full" />
                    <img src="/dragon-icon.png" alt="Onyx" className="logo-mobile" />
                </div>

                {showSearch && (
                    <div className="search-container-centered">
                        <Search className="search-icon" size={20} aria-hidden="true" />
                        <input
                            type="text"
                            placeholder="Search for books..."
                            value={searchQuery}
                            onChange={onSearchChange}
                            className="search-input"
                            aria-label="Search for books"
                        />
                    </div>
                )}

                {selectedUser && (
                    <div className="header-right">
                        <span className="username">{selectedUser.username}</span>
                        <div className="burger-menu-container">
                            <button
                              onClick={handleBurgerMenuToggle}
                              className="burger-menu-button"
                              aria-label="Open menu"
                              aria-expanded={isBurgerMenuOpen}
                            >
                                <Menu size={20} />
                            </button>
                            {isBurgerMenuOpen && (
                                <>
                                    <div className="burger-menu-overlay" onClick={closeBurgerMenu} aria-hidden="true"></div>
                                    <div className="burger-menu" role="menu" aria-label="User menu">
                                        {onAdminClick && (
                                            <button
                                              onClick={() => { onAdminClick(); closeBurgerMenu(); }}
                                              className="burger-menu-item"
                                              role="menuitem"
                                            >
                                                <Settings size={18} aria-hidden="true" />
                                                Admin Panel
                                            </button>
                                        )}
                                        <button
                                          onClick={() => { onUserChange(); closeBurgerMenu(); }}
                                          className="burger-menu-item"
                                          role="menuitem"
                                        >
                                            <User size={18} aria-hidden="true" />
                                            Change User
                                        </button>
                                        <button
                                          onClick={() => { onLogout(); closeBurgerMenu(); }}
                                          className="burger-menu-item"
                                          role="menuitem"
                                        >
                                            <LogOut size={18} aria-hidden="true" />
                                            Logout
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
};

export default Header;
