const DEFAULT_CAPABILITIES = Object.freeze([
  'wifi.install',
  'wifi.manage',
  'hardware.order',
]);

export class PartnerOnboardingService {
  constructor({ db, paymentVerifier, provisioner, notifier, starterKitFulfillment, defaultCreditLimitMinor = 2_500_000, clock = () => new Date().toISOString() }) {
    this.db = db;
    this.paymentVerifier = paymentVerifier;
    this.provisioner = provisioner;
    this.notifier = notifier;
    this.starterKitFulfillment = starterKitFulfillment;
    this.defaultCreditLimitMinor = defaultCreditLimitMinor;
    this.clock = clock;
  }

  async approvePartner(applicationId) {
    const applicationRef = this.db.collection('partner_applications').doc(applicationId);
    const snapshot = await applicationRef.get();
    if (!snapshot.exists) throw new Error(`Partner application not found: ${applicationId}`);

    const application = snapshot.data();
    if (application.status === 'approved' && application.partnerId) {
      return { partnerId: application.partnerId, status: 'already_approved' };
    }

    const payment = await this.paymentVerifier.verifyPartnerDeposit(application);
    if (!payment?.verified || payment.status !== 'settled') throw new Error('Partner deposit is not verified and settled');

    const partnerRef = this.db.collection('tenants').doc();
    const partnerId = partnerRef.id;
    const now = this.clock();
    const currency = application.currency ?? payment.currency;
    const depositMinor = payment.amountMinor;
    const creditLimitMinor = Number.isSafeInteger(application.creditLimitMinor)
      ? application.creditLimitMinor
      : this.defaultCreditLimitMinor;

    if (!currency) throw new Error('Partner currency is required');
    if (!Number.isSafeInteger(depositMinor) || depositMinor < 0) throw new Error('Verified deposit must be integer minor units');
    if (!Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0) throw new Error('Credit limit must be integer minor units');

    const tenant = {
      id: partnerId,
      type: 'partner',
      identity: {
        legalName: application.fullName ?? application.businessName ?? application.firstName,
        tradingName: application.businessName ?? application.firstName,
        phone: application.phone,
      },
      territory: {
        country: application.country ?? null,
        location: application.location ?? null,
      },
      commercial: {
        tier: 'field_partner',
        currency,
        commissionPlanId: 'field-v1',
      },
      accounts: {
        ledgerAccountId: `partner:${partnerId}`,
        creditAccountId: `credit:${partnerId}`,
      },
      credit: {
        limitMinor: creditLimitMinor,
        usedMinor: 0,
        currency,
        status: 'active',
      },
      capabilities: [...DEFAULT_CAPABILITIES],
      status: 'active',
      provisioning: {
        bot: 'pending',
        starterKit: 'pending',
        training: 'pending',
      },
      deposit: {
        amountMinor: depositMinor,
        currency: payment.currency,
        transactionId: payment.id,
        verifiedAt: payment.verifiedAt ?? now,
      },
      createdAt: now,
      activatedAt: now,
    };

    await partnerRef.set(tenant);
    await applicationRef.set({ status: 'approved', partnerId, approvedAt: now }, { merge: true });

    const provisioning = {};
    if (this.provisioner) provisioning.bot = await this.provisioner.provisionPartner({ partnerId, tenant });
    if (this.starterKitFulfillment) provisioning.starterKit = await this.starterKitFulfillment.createOrder({ partnerId, application });
    if (this.notifier) await this.notifier.partnerApproved({ partnerId, application, tenant });

    await partnerRef.set({
      provisioning: {
        bot: provisioning.bot ? 'active' : 'pending',
        starterKit: provisioning.starterKit ? 'ordered' : 'pending',
        training: 'pending',
      },
      updatedAt: this.clock(),
    }, { merge: true });

    return { partnerId, status: 'active', provisioning };
  }
}
