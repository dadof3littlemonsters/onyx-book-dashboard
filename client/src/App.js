import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
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
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1a1a1a',
              color: '#fff',
              border: '1px solid #333',
            },
            success: {
              style: {
                background: '#1a1a1a',
                color: '#4ade80', // green
                border: '1px solid #4ade80',
              },
            },
            error: {
              style: {
                background: '#1a1a1a',
                color: '#f87171', // red
                border: '1px solid #f87171',
              },
            },
          }}
        />
      </div>
    </Router>
  );
}

export default App;