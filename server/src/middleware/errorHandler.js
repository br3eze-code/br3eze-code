/**
 * Global Error Handler
 */

const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    // Log error
    logger.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
    }

    if (err.code === 'auth/id-token-expired') {
        return res.status(401).json({
            success: false,
            error: 'Token expired',
            code: 'TOKEN_EXPIRED'
        });
    }

    if (err.code === 'auth/user-not-found') {
        return res.status(404).json({
            success: false,
            error: 'User not found'
        });
    }

    // MikroTik connection errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        return res.status(503).json({
            success: false,
            error: 'Router unavailable',
            message: 'Unable to connect to MikroTik router'
        });
    }

    // Default error response
    const statusCode = err.statusCode || err.status || 500;

    res.status(statusCode).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

module.exports = errorHandler;