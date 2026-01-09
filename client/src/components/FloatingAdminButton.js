import React from 'react';
import { Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import './FloatingAdminButton.css';

const FloatingAdminButton = () => {
  return (
    <Link to="/admin" className="floating-admin-button">
      <Shield size={24} />
    </Link>
  );
};

export default FloatingAdminButton;