import React, { useState, useRef, useEffect } from 'react';
import { EventType } from '../channels.js';

function relativeTime(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Props:
 *   messages  – [{ id, displayName, text, sentAt }]
 *   onSend    – (text) => void
 *   canSend   – boolean (false for host read-only mode)
 */
export default function ChatPanel({ messages = [], onSend, canSend = true }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <div className="chat-panel card">
      <h3 className="chat-title">Chat</h3>
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">No messages yet…</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id || msg.sentAt} className="chat-msg">
            <span className="chat-name">{msg.displayName}</span>
            <span className="chat-text">{msg.text}</span>
            <span className="chat-time">{relativeTime(msg.sentAt)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {canSend && (
        <form className="chat-input-row" onSubmit={handleSend}>
          <input
            className="input chat-input"
            type="text"
            maxLength={200}
            placeholder="Say something…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn-primary chat-send-btn" disabled={!text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
