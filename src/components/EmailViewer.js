import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import quotedPrintable from 'quoted-printable';

// Netflix-inspired color palette
const netflixColors = {
  netflixRed: '#E50914',
  netflixBlack: '#141414',
  netflixDarkGray: '#181818',
  netflixLightGray: '#808080',
  white: '#FFFFFF'
};

const EmailViewer = () => {
  const [gmailId, setGmailId] = useState('');
  const [latestEmails, setLatestEmails] = useState([]);
  const [emailData, setEmailData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationStatus, setVerificationStatus] = useState({});
  const ws = useRef(null);

  useEffect(() => {
    // Cleanup WebSocket on component unmount
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const connectWebSocket = (email) => {
    if (ws.current) {
      ws.current.close();
    }

    // Connect to WebSocket server
    ws.current = new WebSocket('ws://localhost:5000');

    ws.current.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to email updates
      ws.current.send(JSON.stringify({
        type: 'subscribe',
        email
      }));
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'verification_update') {
        setVerificationStatus(prev => ({
          ...prev,
          [data.messageId]: data.status
        }));
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
    };
  };

  // Decode base64 and quoted-printable safely
  const decodeContent = (encoded) => {
    if (!encoded) return '';
    try {
      // Gmail API returns base64url, so replace URL-safe chars
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      // Decode base64 to string
      const decodedBase64 = atob(base64);
      // Decode quoted-printable if needed
      return quotedPrintable.decode(decodedBase64);
    } catch (e) {
      console.warn('Decoding failed, returning raw content:', e);
      return encoded;
    }
  };

  // Extract text and HTML content recursively from payload parts
  const extractEmailContent = (payload) => {
    let text = '';
    let html = '';

    if (!payload) return { textContent: '', htmlContent: '' };

    const findParts = (part) => {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeContent(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeContent(part.body.data);
      } else if (part.parts && part.parts.length > 0) {
        part.parts.forEach(findParts);
      }
    };

    findParts(payload);

    return { textContent: text, htmlContent: html };
  };

  // Extract headers as a key-value object from payload.headers
  const getEmailHeaders = (payload) => {
    if (!payload?.headers) return {};
    const headers = {};
    payload.headers.forEach(({ name, value }) => {
      headers[name.toLowerCase()] = value;
    });
    return headers;
  };

  // Format ISO date string into readable local format
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Extract verification URL (example keywords: verify, confirm, activate)
  const extractVerifyUrl = (email) => {
    if (!email) return null;
    const { textContent, htmlContent } = extractEmailContent(email.payload);
    const textToSearch = textContent || htmlContent || '';
    const urlRegex = /https?:\/\/[^\s<>"]+(verify|confirm|activate)[^\s<>"]*/gi;
    const matches = textToSearch.match(urlRegex);
    return matches ? matches[0] : null;
  };

  // Fetch latest emails by Gmail ID (email address)
  const fetchLatestEmails = async () => {
    if (!gmailId.trim()) {
      alert('Please enter a valid Gmail ID');
      return;
    }

    setLoading(true);
    setError('');
    setLatestEmails([]);
    setEmailData(null);

    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/email/fetch-latest-email`, {
        email: gmailId.trim(),
      });

      if (response.data) {
        setEmailData(response.data);
        setLatestEmails([{ id: response.data.id, snippet: response.data.snippet }]);
        setVerificationStatus(prev => ({
          ...prev,
          [response.data.id]: response.data.verificationStatus
        }));

        // Connect to WebSocket for real-time updates
        connectWebSocket(gmailId.trim());
      } else {
        setError('No emails found for this Gmail ID');
      }
    } catch (err) {
      setError('Failed to fetch latest emails');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch email details by message ID
  const fetchEmailDetails = async (messageId) => {
    if (!messageId) return;

    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/emails/${messageId}`);
      setEmailData(response.data);
      setVerificationStatus(prev => ({
        ...prev,
        [response.data.id]: response.data.verificationStatus
      }));
    } catch (err) {
      setError('Failed to fetch email details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Trigger verification click on backend
  const handleVerifyClick = async (url) => {
    if (!emailData) return;

    try {
      await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/trigger-verify-click`, {
        url,
        email: gmailId.trim(),
        messageId: emailData.id
      });
    } catch (error) {
      console.error('Error triggering verification:', error);
      setError('Failed to trigger verification');
    }
  };

  // Render email content UI
  const renderEmailContent = () => {
    if (!emailData) return null;

    const headers = getEmailHeaders(emailData.payload);
    const { textContent, htmlContent } = extractEmailContent(emailData.payload);
    const verifyUrl = extractVerifyUrl(emailData);

    return (
      <div style={{
        border: `1px solid ${netflixColors.netflixLightGray}`,
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: netflixColors.netflixDarkGray,
        color: netflixColors.white,
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        margin: '20px 0'
      }}>
        <h3 style={{ color: netflixColors.netflixRed, marginBottom: '20px' }}>Email Details</h3>
        <div style={{ marginBottom: '15px' }}>
          <p><strong style={{ color: netflixColors.netflixRed }}>From:</strong> {headers.from || 'N/A'}</p>
          <p><strong style={{ color: netflixColors.netflixRed }}>To:</strong> {headers.to || 'N/A'}</p>
          <p><strong style={{ color: netflixColors.netflixRed }}>Subject:</strong> {headers.subject || 'N/A'}</p>
          <p><strong style={{ color: netflixColors.netflixRed }}>Date:</strong> {formatDate(headers.date)}</p>
        </div>

        <hr style={{ borderColor: netflixColors.netflixLightGray }} />

        {htmlContent ? (
          <div
                style={{
              border: `1px solid ${netflixColors.netflixLightGray}`,
              padding: '15px',
              maxHeight: '400px',
              overflowY: 'auto',
              backgroundColor: netflixColors.netflixBlack,
              borderRadius: '4px'
            }}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        ) : (
              <pre style={{
                whiteSpace: 'pre-wrap',
            backgroundColor: netflixColors.netflixBlack,
            padding: '15px',
                maxHeight: '300px',
            overflowY: 'auto',
            borderRadius: '4px',
            color: netflixColors.white
              }}>
            {textContent || 'No content available.'}
              </pre>
          )}

        {verifyUrl && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ color: netflixColors.netflixRed }}>Verification URL</h4>
            <p style={{ wordBreak: 'break-all', color: netflixColors.white }}>{verifyUrl}</p>
            <button
              onClick={() => handleVerifyClick(verifyUrl)}
              style={{
                backgroundColor: netflixColors.netflixRed,
                color: netflixColors.white,
                padding: '12px 24px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                transition: 'background-color 0.3s ease',
                ':hover': {
                  backgroundColor: '#F40612'
                }
              }}
            >
              Trigger Verification
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      maxWidth: '1200px',
      margin: '0 auto',
      minHeight: '100vh',
      color: netflixColors.white,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      zIndex: 1,
      // Money Heist GIF background
      background: `linear-gradient(rgba(20,20,20,0.85), rgba(20,20,20,0.85)), url('https://i.pinimg.com/736x/19/8b/2f/198b2f01e73b905772279616eccc7c65.jpg') center center / cover no-repeat fixed`
    }}>
      <h1 style={{
        color: netflixColors.netflixRed,
        textAlign: 'center',
        marginBottom: '30px',
        fontSize: '2.5rem'
      }}>
        GmailInbox Inspector
      </h1>

      {error && (
        <div style={{
          color: netflixColors.netflixRed,
          marginBottom: '15px',
          padding: '10px',
          backgroundColor: 'rgba(229, 9, 20, 0.1)',
          borderRadius: '4px',
          border: `1px solid ${netflixColors.netflixRed}`
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{
        marginBottom: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        padding: '20px'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          alignItems: 'center'
        }}>
          <input
            type="text"
            placeholder="Enter Gmail ID (e.g., user@gmail.com)"
            value={gmailId}
            onChange={(e) => setGmailId(e.target.value)}
            style={{
              padding: '12px',
              width: '100%',
              borderRadius: '4px',
              border: `1px solid ${netflixColors.netflixLightGray}`,
              backgroundColor: netflixColors.netflixDarkGray,
              color: netflixColors.white,
              fontSize: '16px',
              textAlign: 'center'
            }}
            disabled={loading}
          />
        <button
          onClick={fetchLatestEmails}
            disabled={loading || !gmailId.trim()}
          style={{
              backgroundColor: netflixColors.netflixRed,
              color: netflixColors.white,
              padding: '12px 24px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              width: '100%',
              transition: 'background-color 0.3s ease',
              opacity: loading || !gmailId.trim() ? 0.7 : 1
            }}
          >
            {loading ? 'Loading...' : 'Fetch Latest Emails'}
        </button>
        </div>
      </div>

      {latestEmails.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ color: netflixColors.netflixRed, marginBottom: '15px' }}>Latest Emails</h3>
          <div
            style={{
              border: `1px solid ${netflixColors.netflixLightGray}`,
              borderRadius: '4px',
              maxHeight: '250px',
              overflowY: 'auto',
              backgroundColor: netflixColors.netflixDarkGray
            }}
          >
            {latestEmails.map((email) => (
              <div
                key={email.id}
                onClick={() => fetchEmailDetails(email.id)}
                style={{
                  padding: '15px',
                  borderBottom: `1px solid ${netflixColors.netflixLightGray}`,
                  cursor: 'pointer',
                  backgroundColor: emailData?.id === email.id ? 'rgba(229, 9, 20, 0.1)' : 'transparent',
                  transition: 'background-color 0.3s ease',
                  ':hover': {
                    backgroundColor: 'rgba(229, 9, 20, 0.05)'
                  }
                }}
                title={email.snippet}
              >
                <strong style={{ color: netflixColors.netflixRed }}>ID:</strong> {email.id} <br />
                <small style={{ color: netflixColors.netflixLightGray }}>{email.snippet}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '20px',
          color: netflixColors.netflixLightGray
        }}>
          Loading email details...
      </div>
      )}

      {emailData && renderEmailContent()}
    </div>
  );
};

export default EmailViewer;
