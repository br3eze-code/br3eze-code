'use strict';

const { google } = require('googleapis');
const axios = require('axios');

/**
 * Base Calendar Adapter
 */
class BaseCalendarAdapter {
    constructor(context) {
        this.context = context || {};
        this.name = 'base';
    }

    async createEvent(event) {
        throw new Error('createEvent not implemented');
    }

    async listEvents(start, end) {
        throw new Error('listEvents not implemented');
    }

    async deleteEvent(id) {
        throw new Error('deleteEvent not implemented');
    }

    async updateEvent(id, event) {
        throw new Error('updateEvent not implemented');
    }
}

/**
 * Google Calendar Adapter
 */
class GoogleCalendarAdapter extends BaseCalendarAdapter {
    constructor(context) {
        super(context);
        this.name = 'google';
        
        if (context?.credentials) {
            this.auth = new google.auth.OAuth2(
                context.credentials.clientId,
                context.credentials.clientSecret,
                context.credentials.redirectUri
            );
            this.auth.setCredentials({
                access_token: context.credentials.accessToken,
                refresh_token: context.credentials.refreshToken
            });
            this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        }
    }

    async createEvent(event) {
        if (!this.calendar) {
            throw new Error('Google Calendar not authenticated');
        }

        const eventBody = {
            summary: event.title,
            description: event.description,
            start: {
                dateTime: event.start,
                timeZone: event.timeZone || 'UTC'
            },
            end: {
                dateTime: event.end,
                timeZone: event.timeZone || 'UTC'
            },
            attendees: event.attendees?.map(email => ({ email })) || []
        };

        const response = await this.calendar.events.insert({
            calendarId: 'primary',
            resource: eventBody
        });

        return {
            id: response.data.id,
            link: response.data.htmlLink,
            provider: 'google'
        };
    }

    async listEvents(start, end) {
        if (!this.calendar) {
            throw new Error('Google Calendar not authenticated');
        }

        const response = await this.calendar.events.list({
            calendarId: 'primary',
            timeMin: start ? new Date(start).toISOString() : new Date().toISOString(),
            timeMax: end ? new Date(end).toISOString() : undefined,
            maxResults: 100,
            singleEvents: true,
            orderBy: 'startTime'
        });

        return response.data.items.map(item => ({
            id: item.id,
            title: item.summary,
            description: item.description,
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            link: item.htmlLink,
            provider: 'google'
        }));
    }

    async deleteEvent(id) {
        if (!this.calendar) {
            throw new Error('Google Calendar not authenticated');
        }

        await this.calendar.events.delete({
            calendarId: 'primary',
            eventId: id
        });

        return { success: true, id };
    }

    async updateEvent(id, event) {
        if (!this.calendar) {
            throw new Error('Google Calendar not authenticated');
        }

        const eventBody = {
            summary: event.title,
            description: event.description,
            start: {
                dateTime: event.start,
                timeZone: event.timeZone || 'UTC'
            },
            end: {
                dateTime: event.end,
                timeZone: event.timeZone || 'UTC'
            }
        };

        const response = await this.calendar.events.patch({
            calendarId: 'primary',
            eventId: id,
            resource: eventBody
        });

        return {
            id: response.data.id,
            link: response.data.htmlLink,
            provider: 'google'
        };
    }
}

/**
 * Outlook/Microsoft Calendar Adapter
 */
class OutlookCalendarAdapter extends BaseCalendarAdapter {
    constructor(context) {
        super(context);
        this.name = 'outlook';
        this.baseUrl = 'https://graph.microsoft.com/v1.0';
        this.accessToken = context?.credentials?.accessToken;
    }

    async createEvent(event) {
        if (!this.accessToken) {
            throw new Error('Outlook not authenticated');
        }

        const eventBody = {
            subject: event.title,
            body: {
                contentType: 'HTML',
                content: event.description || ''
            },
            start: {
                dateTime: event.start,
                timeZone: event.timeZone || 'UTC'
            },
            end: {
                dateTime: event.end,
                timeZone: event.timeZone || 'UTC'
            },
            attendees: event.attendees?.map(email => ({
                emailAddress: { address: email },
                type: 'required'
            })) || []
        };

        const response = await axios.post(
            `${this.baseUrl}/me/events`,
            eventBody,
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return {
            id: response.data.id,
            link: response.data.webLink,
            provider: 'outlook'
        };
    }

    async listEvents(start, end) {
        if (!this.accessToken) {
            throw new Error('Outlook not authenticated');
        }

        const params = new URLSearchParams();
        if (start) params.append('startDateTime', new Date(start).toISOString());
        if (end) params.append('endDateTime', new Date(end).toISOString());
        params.append('$top', '100');

        const response = await axios.get(
            `${this.baseUrl}/me/calendarview?${params.toString()}`,
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            }
        );

        return response.data.value.map(item => ({
            id: item.id,
            title: item.subject,
            description: item.body?.content,
            start: item.start.dateTime,
            end: item.end.dateTime,
            link: item.webLink,
            provider: 'outlook'
        }));
    }

    async deleteEvent(id) {
        if (!this.accessToken) {
            throw new Error('Outlook not authenticated');
        }

        await axios.delete(
            `${this.baseUrl}/me/events/${id}`,
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            }
        );

        return { success: true, id };
    }

    async updateEvent(id, event) {
        if (!this.accessToken) {
            throw new Error('Outlook not authenticated');
        }

        const eventBody = {
            subject: event.title,
            body: {
                contentType: 'HTML',
                content: event.description || ''
            },
            start: {
                dateTime: event.start,
                timeZone: event.timeZone || 'UTC'
            },
            end: {
                dateTime: event.end,
                timeZone: event.timeZone || 'UTC'
            }
        };

        const response = await axios.patch(
            `${this.baseUrl}/me/events/${id}`,
            eventBody,
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return {
            id: response.data.id,
            link: response.data.webLink,
            provider: 'outlook'
        };
    }
}

/**
 * Local Calendar Adapter (SQLite-based)
 */
class LocalCalendarAdapter extends BaseCalendarAdapter {
    constructor(context) {
        super(context);
        this.name = 'local';
        this.events = new Map(); // In-memory storage for demo
        
        // In production, this would use better-sqlite3
        if (context?.db) {
            this.db = context.db;
        }
    }

    async createEvent(event) {
        const id = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const eventData = {
            id,
            title: event.title,
            description: event.description,
            start: event.start,
            end: event.end,
            attendees: event.attendees || [],
            createdAt: new Date().toISOString(),
            provider: 'local'
        };

        this.events.set(id, eventData);
        
        // Persist to SQLite if available
        if (this.db) {
            // SQLite persistence logic here
        }

        return {
            id,
            link: null,
            provider: 'local'
        };
    }

    async listEvents(start, end) {
        const events = Array.from(this.events.values());
        
        return events.filter(event => {
            const eventStart = new Date(event.start);
            const filterStart = start ? new Date(start) : new Date(0);
            const filterEnd = end ? new Date(end) : new Date(8640000000000000);
            
            return eventStart >= filterStart && eventStart <= filterEnd;
        }).sort((a, b) => new Date(a.start) - new Date(b.start));
    }

    async deleteEvent(id) {
        const existed = this.events.has(id);
        this.events.delete(id);
        
        if (!existed) {
            throw new Error(`Event ${id} not found`);
        }

        return { success: true, id };
    }

    async updateEvent(id, event) {
        const existing = this.events.get(id);
        if (!existing) {
            throw new Error(`Event ${id} not found`);
        }

        const updated = {
            ...existing,
            title: event.title || existing.title,
            description: event.description || existing.description,
            start: event.start || existing.start,
            end: event.end || existing.end,
            attendees: event.attendees || existing.attendees,
            updatedAt: new Date().toISOString()
        };

        this.events.set(id, updated);

        return {
            id,
            link: null,
            provider: 'local'
        };
    }
}

/**
 * Calendar Skill - Main entry point
 */
class CalendarSkill {
    constructor() {
        this.name = 'calendar';
        this.description = 'Manage calendar events across providers';
        this.version = '1.0.0';
    }

    getAdapter(provider, context) {
        switch (provider) {
            case 'google':
                return new GoogleCalendarAdapter(context);
            case 'outlook':
                return new OutlookCalendarAdapter(context);
            case 'local':
            default:
                return new LocalCalendarAdapter(context);
        }
    }

    async execute(params, context = {}) {
        const { action, provider = 'local', event } = params;
        
        const adapter = this.getAdapter(provider, context);

        switch (action) {
            case 'create':
                if (!event) throw new Error('Event data required for create action');
                return await adapter.createEvent(event);
                
            case 'list':
                return await adapter.listEvents(event?.start, event?.end);
                
            case 'delete':
                if (!event?.id) throw new Error('Event ID required for delete action');
                return await adapter.deleteEvent(event.id);
                
            case 'update':
                if (!event?.id) throw new Error('Event ID required for update action');
                return await adapter.updateEvent(event.id, event);
                
            default:
                throw new Error(`Unknown action: ${action}. Supported: create, list, delete, update`);
        }
    }

    getTools() {
        return {
            'calendar.create': {
                description: 'Create a calendar event',
                parameters: {
                    provider: { type: 'string', enum: ['google', 'outlook', 'local'], default: 'local' },
                    event: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', required: true },
                            description: { type: 'string' },
                            start: { type: 'string', format: 'date-time', required: true },
                            end: { type: 'string', format: 'date-time', required: true },
                            attendees: { type: 'array', items: { type: 'string' } }
                        }
                    }
                }
            },
            'calendar.list': {
                description: 'List calendar events',
                parameters: {
                    provider: { type: 'string', enum: ['google', 'outlook', 'local'], default: 'local' },
                    start: { type: 'string', format: 'date-time' },
                    end: { type: 'string', format: 'date-time' }
                }
            },
            'calendar.delete': {
                description: 'Delete a calendar event',
                parameters: {
                    provider: { type: 'string', enum: ['google', 'outlook', 'local'], default: 'local' },
                    id: { type: 'string', required: true }
                }
            },
            'calendar.update': {
                description: 'Update a calendar event',
                parameters: {
                    provider: { type: 'string', enum: ['google', 'outlook', 'local'], default: 'local' },
                    id: { type: 'string', required: true },
                    event: { type: 'object' }
                }
            }
        };
    }
}

// Export both the skill and adapters for testing
module.exports = new CalendarSkill();
module.exports.CalendarSkill = CalendarSkill;
module.exports.GoogleCalendarAdapter = GoogleCalendarAdapter;
module.exports.OutlookCalendarAdapter = OutlookCalendarAdapter;
module.exports.LocalCalendarAdapter = LocalCalendarAdapter;
module.exports.BaseCalendarAdapter = BaseCalendarAdapter;

