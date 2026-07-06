// src/commands/payment-commands.js
// Telegram bot commands for payments

const paymentService = require('../payments');

module.exports = function setupPaymentCommands(bot, paymentSvc) {
  
  // /buy command - Start voucher purchase
  bot.command('buy', async (ctx) => {
    const userId = ctx.from.id;
    
    // Show voucher options
    await ctx.reply('💳 Select a voucher package:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 Hour - $1.00', callback_data: 'buy_1Hour_1.00' },
            { text: '1 Day - $3.00', callback_data: 'buy_1Day_3.00' }
          ],
          [
            { text: '1 Week - $10.00', callback_data: 'buy_1Week_10.00' },
            { text: '1 Month - $25.00', callback_data: 'buy_1Month_25.00' }
          ]
        ]
      }
    });
  });

  // Handle voucher selection
  bot.action(/buy_(.+)_(.+)/, async (ctx) => {
    const [, voucherType, amount] = ctx.match;
    const userId = ctx.from.id;
    
    // Get available payment methods
    const methods = await paymentSvc.getAvailablePaymentMethods({
      country: 'ZW', // Detect from user profile
      device: 'mobile'
    });

    // Show payment method selection
    const buttons = methods.map(m => [{
      text: `${m.icon} ${m.name}`,
      callback_data: `pay_${voucherType}_${amount}_${m.id}`
    }]);

    await ctx.editMessageText(
      `Selected: ${voucherType} - $${amount}\n\nChoose payment method:`,
      { reply_markup: { inline_keyboard: buttons } }
    );
  });

  // Handle payment method selection
  bot.action(/pay_(.+)_(.+)_(.+)/, async (ctx) => {
    const [, voucherType, amount, method] = ctx.match;
    const userId = ctx.from.id;

    try {
      // Get user's phone from profile or ask
      const user = await ctx.getChatMember(userId);
      
      const result = await paymentSvc.purchaseVoucher({
        userId: userId.toString(),
        voucherType,
        amount: parseFloat(amount),
        currency: 'USD',
        paymentMethod: method,
        customerPhone: user.phone_number || '',
        customerEmail: user.email || ''
      });

      if (method === 'ecocash' || method === 'netone') {
        await ctx.editMessageText(
          `📱 ${result.instructions}\n\n` +
          `Reference: ${result.reference}\n` +
          `Amount: $${amount}\n\n` +
          `Click "Check Status" once you've approved the payment on your phone.`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '🔍 Check Status', callback_data: `check_${result.transactionId}_${method}` }
              ]]
            }
          }
        );
      } else if (method === 'paynow') {
        await ctx.editMessageText(
          `🔗 Click the link below to complete payment:\n\n${result.redirectUrl}`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '💳 Pay Now', url: result.redirectUrl },
                { text: '🔍 Check Status', callback_data: `check_${result.transactionId}_${method}` }
              ]]
            }
          }
        );
      } else if (method === 'stripe') {
        await ctx.editMessageText(
          `💳 Complete your payment securely:\n\n` +
          `Use this link to pay with card:`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '💳 Pay with Card', url: `https://pay.stripe.com/${result.clientSecret}` }
              ]]
            }
          }
        );
      }
    } catch (error) {
      await ctx.reply(`❌ Payment error: ${error.message}`);
    }
  });

  // Check payment status
  bot.action(/check_(.+)_(.+)/, async (ctx) => {
    const [, transactionId, method] = ctx.match;
    
    try {
      const status = await paymentSvc.gateway.verifyPayment(method, transactionId);
      
      if (status.success) {
        // Generate and send voucher
        const voucher = await paymentSvc.processSuccessfulPayment(transactionId, method);
        
        await ctx.editMessageText(
          `✅ Payment successful!\n\n` +
          `🎫 Your WiFi Voucher Code:\n` +
          `\`${voucher.voucher.code}\`\n\n` +
          `Type: ${voucher.voucher.type}\n` +
          `Valid until: ${voucher.voucher.expiresAt.toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.answerCbQuery('⏳ Payment still pending. Please try again in a moment.');
      }
    } catch (error) {
      await ctx.answerCbQuery(`❌ Error: ${error.message}`);
    }
  });

  // /balance command - Check wallet/vouchers
  bot.command('vouchers', async (ctx) => {
    const userId = ctx.from.id;
    const vouchers = await paymentSvc.getTransactionHistory(userId.toString(), { limit: 5 });
    
    let message = '🎫 Your Recent Vouchers:\n\n';
    vouchers.forEach((v, i) => {
      message += `${i + 1}. ${v.voucherType} - $${v.amount} (${v.status})\n`;
    });
    
    await ctx.reply(message);
  });
};
