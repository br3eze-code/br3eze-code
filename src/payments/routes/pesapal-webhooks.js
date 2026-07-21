// Stub — PesaPal webhook routes
function setupPesaPalRoutes(app, service) {
  if (!app || typeof app.post !== 'function') return;
  app.post('/api/webhooks/pesapal', async (req, res) => {
    res.json({ received: true });
  });
}
export default setupPesaPalRoutes;
