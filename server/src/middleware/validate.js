/**
 * Request Validation Middleware
 */

const { validationResult, body, param, query } = require('express-validator');

const requestValidator = (req, res, next) => {
    // Sanitize common fields
    if (req.body) {
        // Remove potential NoSQL injection operators
        const sanitize = (obj) => {
            if (typeof obj !== 'object' || obj === null) return obj;

            const sanitized = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key.startsWith('$')) continue; // Remove MongoDB operators

                if (typeof value === 'object') {
                    sanitized[key] = sanitize(value);
                } else {
                    sanitized[key] = value;
                }
            }
            return sanitized;
        };

        req.body = sanitize(req.body);
    }

    next();
};

const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        res.status(400).json({
            success: false,
            errors: errors.array()
        });
    };
};

module.exports = {
    requestValidator,
    validate,
    body,
    param,
    query
};