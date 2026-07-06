/**
 * AgentOS Hermes — config.js
 * Single source of truth for client-side constants
 */
'use strict';

const CFG = {
  APP:     'AgentOS Hermes',
  VER:     '2026.6.17',
  PORT:    19876,              // default gateway port
  WS_PATH: '/ws',
  API:     '/api/v1',
  API2:    '/api/v2',
  API3:    '/api/v3',

  // ReAct loop limits
  REACT_MAX_TURNS:  8,
  REACT_TIMEOUT_MS: 30000,
  API_TIMEOUT_MS:   20000,
  WS_RECONNECT_MS:  4000,
  WS_MAX_RETRY:     12,

  // Voucher plans (mirrors DEFAULT_PLANS on server)
  PLANS: {
    '1hour':  { name: '1 Hour',   price: 1.00,  dur: '1h',   unit: 'hours',   val: 1 },
    '1Day':   { name: '1 Day',    price: 5.00,  dur: '1d',   unit: 'days',    val: 1 },
    '7Day':   { name: '7 Days',   price: 25.00, dur: '7d',   unit: 'days',    val: 7 },
    '30Day':  { name: '30 Days',  price: 80.00, dur: '30d',  unit: 'days',    val: 30 },
    'weekly': { name: '1 Week',   price: 25.00, dur: '7d',   unit: 'days',    val: 7 },
    'monthly':{ name: '1 Month',  price: 80.00, dur: '30d',  unit: 'days',    val: 30 },
  },
};

const KEYS = {
  URL:      'aos_url',
  TOKEN:    'aos_token',
  MODEL:    'aos_model',
  TURNS:    'aos_turns',
  HISTORY:  'aos_chat_history',
  ACTIVITY: 'aos_activity',
};
