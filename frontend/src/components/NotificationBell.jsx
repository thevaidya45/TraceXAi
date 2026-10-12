import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatRelativeTime,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '../services/notificationService.js';

export default function NotificationBell() {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState([]);

  async function load() {
    try {
      const res = await getNotifications();
      setUnreadCount(res.data.unreadCount || 0);
      setItems(res.data.notifications || []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onDocClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
    }
  }

  async function handleOpen(item) {
    try {
      if (!item.read) {
        await markNotificationRead(item.id);
      }
    } catch {
      /* still navigate */
    }
    setOpen(false);
    navigate(item.href);
    load();
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead();
      await load();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="notify-wrap" ref={rootRef}>
      <button
        type="button"
        className="notify-bell"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={openPanel}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unreadCount > 0 ? <span className="notify-count">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notify-panel" role="dialog" aria-label="Notifications">
          <div className="notify-panel-head">
            <strong>Notifications</strong>
            {unreadCount > 0 ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={handleMarkAll}>
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="notify-empty">No notifications yet.</p>
          ) : (
            <ul className="notify-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.read ? 'notify-item' : 'notify-item is-unread'}
                    onClick={() => handleOpen(item)}
                  >
                    <span className="notify-item-title">{item.title}</span>
                    <span className="notify-item-body">{item.message}</span>
                    <span className="notify-item-time">{formatRelativeTime(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
