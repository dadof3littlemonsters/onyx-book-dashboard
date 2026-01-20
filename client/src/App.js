import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './components/HomePage';
import AdminDashboard from './components/AdminDashboard';
import ImportLog from './components/ImportLog';
import FloatingAdminButton from './components/FloatingAdminButton';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/imports" element={<ImportLog />} />
        </Routes>
        <FloatingAdminButton />
      </div>
    </Router>
  );
}

export default App;