'use strict';
/**
 * MobileMoney — Generic Mobile Money Abstraction
 * Providers: Safaricom Daraja (Kenya), Vodacom (Tanzania), MTN MoMo, Airtel Money
 *
 * Usage:
 *   const mm = new MobileMoney();
 *   const { checkoutRequestId } = await mm.initiate('safaricom', '+254712345678', 10, 'AGT-1DAY');
 *   const { paid } = await mm.verify('safaricom', checkoutRequestId);
 */

const crypto = require('crypto');
const { logger } = require('../core/logger');

// ── Token cache: { provider -> { token, expiresAt } } ──────────────────────
const _tokenCache = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function _mpesaTimestamp() {
    return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function _mpesaPassword(shortcode, passkey, timestamp) {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function _fetchToken(provider, fetcher, ttlSeconds = 3500) {
    const cached = _tokenCache.get(provider);
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const token = await fetcher();
    _tokenCache.set(provider, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
}

function _e164(phone) {
    // Normalise phone to E.164 (+countrycode...)
    const digits = phone.replace(/\D/g, '');
    if (phone.startsWith('+')) return phone;
    if (digits.startsWith('0')) return `+${digits.slice(1)}`; // naïve local prefix strip
    return `+${digits}`;
}

function _phoneDigits(phone) {
    return _e164(phone).replace('+', '');
}

// ── Provider implementations ─────────────────────────────────────────────────

const providers = {

    // ────────────────────────────────────────────────────────────
    // Safaricom Daraja (Kenya — KES)
    // ────────────────────────────────────────────────────────────
    async safaricom_initiate(phone, amount, reference) {
        const axios = require('axios');
        const consumerKey    = process.env.MPESA_CONSUMER_KEY;
        const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
        const shortcode      = process.env.MPESA_SHORTCODE;
        const passkey        = process.env.MPESA_PASSKEY;
        const callbackUrl    = process.env.MPESA_CALLBACK_URL || 'https://agentos.local/api/webhook/mpesa/safaricom';
        const env            = process.env.MPESA_ENV || 'sandbox';
        const base           = env === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';

        if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
            throw new Error('[MobileMoney] Safaricom credentials missing — set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY');
        }

        // 1. Get cached access token
        const token = await _fetchToken('safaricom', async () => {
            const r = await axios.get(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
                auth: { username: consumerKey, password: consumerSecret }
            });
            return r.data.access_token;
        });

        // 2. Send STK Push
        const timestamp = _mpesaTimestamp();
        const password  = _mpesaPassword(shortcode, passkey, timestamp);
        const phoneNum  = _phoneDigits(phone);

        const resp = await axios.post(`${base}/mpesa/stkpush/v1/processrequest`, {
            BusinessShortCode: shortcode,
            Password:          password,
            Timestamp:         timestamp,
            TransactionType:   'CustomerPayBillOnline',
            Amount:            Math.ceil(amount),
            PartyA:            phoneNum,
            PartyB:            shortcode,
            PhoneNumber:       phoneNum,
            CallBackURL:       callbackUrl,
            AccountReference:  reference || 'AgentOS',
            TransactionDesc:   `WiFi Access — ${reference || 'AgentOS'}`
        }, { headers: { Authorization: `Bearer ${token}` } });

        return {
            checkoutRequestId: resp.data.CheckoutRequestID,
            merchantRequestId: resp.data.MerchantRequestID,
            responseCode:      resp.data.ResponseCode,
            responseDesc:      resp.data.ResponseDescription,
            provider:          'safaricom'
        };
    },

    async safaricom_verify(checkoutRequestId) {
        const axios = require('axios');
        const consumerKey    = process.env.MPESA_CONSUMER_KEY;
        const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
        const shortcode      = process.env.MPESA_SHORTCODE;
        const passkey        = process.env.MPESA_PASSKEY;
        const env            = process.env.MPESA_ENV || 'sandbox';
        const base           = env === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';

        const token = await _fetchToken('safaricom', async () => {
            const r = await axios.get(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
                auth: { username: consumerKey, password: consumerSecret }
            });
            return r.data.access_token;
        });

        const timestamp = _mpesaTimestamp();
        const password  = _mpesaPassword(shortcode, passkey, timestamp);

        const resp = await axios.post(`${base}/mpesa/stkpushquery/v1/query`, {
            BusinessShortCode: shortcode,
            Password:          password,
            Timestamp:         timestamp,
            CheckoutRequestID: checkoutRequestId
        }, { headers: { Authorization: `Bearer ${token}` } });

        return {
            paid:       String(resp.data?.ResultCode) === '0',
            resultCode: resp.data?.ResultCode,
            resultDesc: resp.data?.ResultDesc,
            reference:  checkoutRequestId
        };
    },

    safaricom_webhook(payload, secret) {
        // Safaricom doesn't sign webhooks — validate by checking known fields
        const body = payload?.Body?.stkCallback;
        if (!body) return { valid: false };
        return {
            valid:             true,
            paid:              String(body.ResultCode) === '0',
            checkoutRequestId: body.CheckoutRequestID,
            amount:            body.CallbackMetadata?.Item?.find(i => i.Name === 'Amount')?.Value,
            phone:             body.CallbackMetadata?.Item?.find(i => i.Name === 'PhoneNumber')?.Value,
            mpesaRef:          body.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value
        };
    },

    // ────────────────────────────────────────────────────────────
    // Vodacom Tanzania (TZS)
    // ────────────────────────────────────────────────────────────
    async vodacom_initiate(phone, amount, reference) {
        const axios = require('axios');
        const clientId     = process.env.VODACOM_CLIENT_ID;
        const clientSecret = process.env.VODACOM_CLIENT_SECRET;
        const base         = process.env.VODACOM_BASE_URL || 'https://openapi.m-pesa.com/sandbox';

        if (!clientId || !clientSecret) {
            throw new Error('[MobileMoney] Vodacom credentials missing — set VODACOM_CLIENT_ID, VODACOM_CLIENT_SECRET');
        }

        const token = await _fetchToken('vodacom', async () => {
            const r = await axios.post(`${base}/ipg/v2/vodacomTZN/getSession/`, {}, {
                auth: { username: clientId, password: clientSecret }
            });
            return r.data.output_SessionID;
        }, 3000);

        const sessionId  = token;
        const thirdPartyId = reference || `AGT-${Date.now()}`;

        const resp = await axios.post(`${base}/ipg/v2/vodacomTZN/c2bPayment/singleStage/`, {
            input_Amount:           String(Math.ceil(amount)),
            input_Country:          'TZN',
            input_Currency:         'TZS',
            input_CustomerMSISDN:   _phoneDigits(phone),
            input_ServiceProviderCode: process.env.VODACOM_SPCODE || '000000',
            input_ThirdPartyConversationID: thirdPartyId,
            input_TransactionReference: thirdPartyId,
            input_PurchasedItemsDesc: `WiFi — ${reference}`
        }, { headers: { 'Authorization': `Bearer ${sessionId}`, 'Origin': '*' } });

        return {
            checkoutRequestId: resp.data.output_ConversationID,
            transactionId:     resp.data.output_TransactionID,
            responseCode:      resp.data.output_ResponseCode,
            provider:          'vodacom'
        };
    },

    async vodacom_verify(conversationId) {
        // Vodacom Tanzania uses callback/IPN model — poll not available in sandbox
        // Return pending; real resolution comes via webhook
        return { paid: false, pending: true, reference: conversationId };
    },

    vodacom_webhook(payload, secret) {
        const paid = payload?.output_ResponseCode === 'INS-0';
        return {
            valid:             true,
            paid,
            checkoutRequestId: payload?.output_ConversationID,
            amount:            payload?.output_Amount,
            phone:             payload?.output_CustomerMSISDN,
            mpesaRef:          payload?.output_TransactionID
        };
    },

    // ────────────────────────────────────────────────────────────
    // MTN MoMo (Multi-country)
    // ────────────────────────────────────────────────────────────
    async mtn_initiate(phone, amount, reference) {
        const axios = require('axios');
        const subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY;
        const apiUser         = process.env.MTN_API_USER;
        const apiKey          = process.env.MTN_API_KEY;
        const currency        = process.env.MTN_CURRENCY || 'EUR'; // EUR in sandbox
        const base            = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
        const callbackUrl     = process.env.MTN_CALLBACK_URL || 'https://agentos.local/api/webhook/mpesa/mtn';

        if (!subscriptionKey || !apiUser || !apiKey) {
            throw new Error('[MobileMoney] MTN MoMo credentials missing — set MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY');
        }

        const token = await _fetchToken('mtn', async () => {
            const r = await axios.post(`${base}/collection/token/`, {}, {
                auth: { username: apiUser, password: apiKey },
                headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey }
            });
            return r.data.access_token;
        });

        const externalId = reference || crypto.randomUUID();

        await axios.post(`${base}/collection/v1_0/requesttopay`, {
            amount:        String(Math.ceil(amount)),
            currency,
            externalId,
            payer: { partyIdType: 'MSISDN', partyId: _phoneDigits(phone) },
            payerMessage:  `WiFi Access — ${reference || 'AgentOS'}`,
            payeeNote:     `AgentOS WiFi`
        }, {
            headers: {
                'Authorization':              `Bearer ${token}`,
                'X-Reference-Id':             externalId,
                'X-Target-Environment':       process.env.MTN_ENV || 'sandbox',
                'Ocp-Apim-Subscription-Key':  subscriptionKey,
                'Content-Type':               'application/json'
            }
        });

        return { checkoutRequestId: externalId, provider: 'mtn' };
    },

    async mtn_verify(externalId) {
        const axios = require('axios');
        const subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY;
        const apiUser         = process.env.MTN_API_USER;
        const apiKey          = process.env.MTN_API_KEY;
        const base            = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';

        const token = await _fetchToken('mtn', async () => {
            const r = await axios.post(`${base}/collection/token/`, {}, {
                auth: { username: apiUser, password: apiKey },
                headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey }
            });
            return r.data.access_token;
        });

        const resp = await axios.get(`${base}/collection/v1_0/requesttopay/${externalId}`, {
            headers: {
                'Authorization':             `Bearer ${token}`,
                'X-Target-Environment':      process.env.MTN_ENV || 'sandbox',
                'Ocp-Apim-Subscription-Key': subscriptionKey
            }
        });

        return {
            paid:      resp.data?.status === 'SUCCESSFUL',
            status:    resp.data?.status,
            reference: externalId
        };
    },

    mtn_webhook(payload, secret) {
        return {
            valid:             true,
            paid:              payload?.status === 'SUCCESSFUL',
            checkoutRequestId: payload?.externalId,
            amount:            payload?.amount,
            phone:             payload?.payer?.partyId
        };
    },

    // ────────────────────────────────────────────────────────────
    // Airtel Money (Multi-country)
    // ────────────────────────────────────────────────────────────
    async airtel_initiate(phone, amount, reference) {
        const axios = require('axios');
        const clientId     = process.env.AIRTEL_CLIENT_ID;
        const clientSecret = process.env.AIRTEL_CLIENT_SECRET;
        const country      = process.env.AIRTEL_COUNTRY || 'KE';
        const currency     = process.env.AIRTEL_CURRENCY || 'KES';
        const base         = process.env.AIRTEL_BASE_URL || 'https://openapi.airtel.africa';
        const callbackUrl  = process.env.AIRTEL_CALLBACK_URL || 'https://agentos.local/api/webhook/mpesa/airtel';

        if (!clientId || !clientSecret) {
            throw new Error('[MobileMoney] Airtel Money credentials missing — set AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET');
        }

        const token = await _fetchToken('airtel', async () => {
            const r = await axios.post(`${base}/auth/oauth2/token`, {
                client_id:     clientId,
                client_secret: clientSecret,
                grant_type:    'client_credentials'
            });
            return r.data.access_token;
        });

        const txRef = reference || `AGT-${Date.now()}`;

        const resp = await axios.post(`${base}/merchant/v2/payments/`, {
            reference: txRef,
            subscriber: { country, currency, msisdn: _phoneDigits(phone) },
            transaction: { amount: Math.ceil(amount), country, currency, id: txRef }
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Country':     country,
                'X-Currency':    currency,
                'Accept':        'application/json',
                'Content-Type':  'application/json'
            }
        });

        return {
            checkoutRequestId: resp.data?.data?.transaction?.id || txRef,
            status:            resp.data?.data?.transaction?.status,
            provider:          'airtel'
        };
    },

    async airtel_verify(transactionId) {
        const axios = require('axios');
        const clientId     = process.env.AIRTEL_CLIENT_ID;
        const clientSecret = process.env.AIRTEL_CLIENT_SECRET;
        const country      = process.env.AIRTEL_COUNTRY || 'KE';
        const currency     = process.env.AIRTEL_CURRENCY || 'KES';
        const base         = process.env.AIRTEL_BASE_URL || 'https://openapi.airtel.africa';

        const token = await _fetchToken('airtel', async () => {
            const r = await axios.post(`${base}/auth/oauth2/token`, {
                client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials'
            });
            return r.data.access_token;
        });

        const resp = await axios.get(`${base}/standard/v1/payments/${transactionId}`, {
            headers: { 'Authorization': `Bearer ${token}`, 'X-Country': country, 'X-Currency': currency }
        });

        return {
            paid:      resp.data?.data?.transaction?.status === 'TS',
            status:    resp.data?.data?.transaction?.status,
            reference: transactionId
        };
    },

    airtel_webhook(payload, secret) {
        return {
            valid:             true,
            paid:              payload?.transaction?.status_code === 'TS',
            checkoutRequestId: payload?.transaction?.id,
            amount:            payload?.transaction?.amount,
            phone:             payload?.transaction?.msisdn
        };
    }
};

// ── Public class ─────────────────────────────────────────────────────────────

class MobileMoney {

    /**
     * Initiate a payment request (STK Push / USSD push).
     * @param {string} provider  'safaricom' | 'vodacom' | 'mtn' | 'airtel'
     * @param {string} phone     E.164 or local format phone number
     * @param {number} amount    Amount in provider's currency
     * @param {string} reference Short reference string (plan name etc.)
     * @returns {{ checkoutRequestId, provider, ... }}
     */
    async initiate(provider, phone, amount, reference) {
        const key = `${provider}_initiate`;
        if (!providers[key]) throw new Error(`[MobileMoney] Unknown provider: ${provider}`);
        logger.info(`[MobileMoney] Initiating ${provider} payment: ${phone} → ${amount} (${reference})`);
        return providers[key](phone, amount, reference);
    }

    /**
     * Verify payment status by checkout/transaction ID.
     * @param {string} provider
     * @param {string} checkoutId
     */
    async verify(provider, checkoutId) {
        const key = `${provider}_verify`;
        if (!providers[key]) throw new Error(`[MobileMoney] Unknown provider: ${provider}`);
        return providers[key](checkoutId);
    }

    /**
     * Parse and validate an incoming IPN/webhook payload.
     * @param {string} provider
     * @param {object} payload  Raw parsed JSON body
     * @param {string} [secret] HMAC secret (if applicable)
     * @returns {{ valid, paid, checkoutRequestId, amount, phone, mpesaRef }}
     */
    webhook(provider, payload, secret) {
        const key = `${provider}_webhook`;
        if (!providers[key]) throw new Error(`[MobileMoney] Unknown provider: ${provider}`);
        return providers[key](payload, secret);
    }

    /**
     * List supported providers.
     */
    supportedProviders() {
        return ['safaricom', 'vodacom', 'mtn', 'airtel'];
    }

    /**
     * Clear token cache (useful for testing).
     */
    clearCache() {
        _tokenCache.clear();
    }
}

module.exports = { MobileMoney };
