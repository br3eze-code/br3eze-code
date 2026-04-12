/**
 * API Routes v1
 * @module api/routes/v1
 */

const express = require('express');
const router = express.Router();
const { getManager } = require('../../core/mikrotik');
const { logger } = require('../../core/logger');

// Middleware
router.use((req, res, next) => {
  logger.debug(`API v1 ${req.method} ${req.path}`);
  next();
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v1' });
});

// Get system stats
router.get('/stats', async (req, res) => {
  try {
    const manager = getManager();
    const stats = await manager.executeTool('system.stats');
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active users
router.get('/users/active', async (req, res) => {
  try {
    const manager = getManager();
    const users = await manager.executeTool('users.active');
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute tool
router.post('/execute', async (req, res) => {
  try {
    const { tool, params } = req.body;
    const manager = getManager();
    const result = await manager.executeTool(tool, params);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;