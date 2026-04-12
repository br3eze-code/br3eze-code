
// skills/calendar/index.js
class CalendarSkill {
  async execute(params, context) {
    const { action, provider = 'local', event } = params;
    
    const adapter = this.getAdapter(provider, context);
    
    switch (action) {
      case 'create':
        return adapter.createEvent(event);
      case 'list':
        return adapter.listEvents(event?.start, event?.end);
      case 'delete':
        return adapter.deleteEvent(event?.id);
      case 'update':
        return adapter.updateEvent(event?.id, event);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
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
}

module.exports = new CalendarSkill();
