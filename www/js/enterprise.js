
/**
 * ==========================================================
 * 📈 EnterpriseLogic (Auto-Procurement Edition)
 * ==========================================================
 */

const EnterpriseLogic = {
    THRESHOLD: 0.85, // 85% Load triggers procurement
    CURRENCY: '$',

    async processPlanPurchase(purchase) {
        console.log(`[Enterprise] Processing Plan Purchase: ${purchase.planId} for Node: ${purchase.nodeId}`);

        // Update node load
        const node = await this.getNodeStatus(purchase.nodeId);
        const newLoad = node.currentLoad + (purchase.capacityWeight || 0.05);

        // Check threshold
        if (newLoad >= this.THRESHOLD) {
            console.warn(`🚨 Node ${purchase.nodeId} load (${(newLoad * 100).toFixed(1)}%) >= Threshold! Starting Procurement...`);
            return await this.identifyProcurementNeed(purchase.nodeId, newLoad);
        } else {
            console.log(`✅ Node ${purchase.nodeId} load: ${(newLoad * 100).toFixed(1)}%. No action required.`);
            return { action: 'NONE', load: newLoad };
        }
    },

    async identifyProcurementNeed(nodeId, currentLoad) {
        const overloadDate = new Date();
        overloadDate.setDate(overloadDate.getDate() + 14);

        const vendors = [
            { id: 'V-NETGEAR', name: 'NetGear Pro', price: 120, deliveryDays: 3, quality: 'High' },
            { id: 'V-TP LINK', name: 'TP-Link Bulk', price: 95, deliveryDays: 7, quality: 'Medium' },
            { id: 'V-UBIQUITI', name: 'Ubiquiti Edge', price: 150, deliveryDays: 5, quality: 'Ultra' }
        ];

        const selectedVendor = vendors.reduce((prev, curr) => (curr.price < prev.price ? curr : prev));

        const qty = 10;
        const bulkDiscount = qty >= 10 ? 0.15 : 0;
        const totalBasePrice = selectedVendor.price * qty;
        const discountAmount = totalBasePrice * bulkDiscount;

        const bufferDays = 5;
        const spareUnits = 2;
        const finalQty = qty + spareUnits;
        const finalPrice = (selectedVendor.price * finalQty) - discountAmount;

        const schedule = {
            nodeId,
            vendorId: selectedVendor.id,
            vendorName: selectedVendor.name,
            item: 'Access Point Gen-3',
            qty: finalQty,
            basePrice: selectedVendor.price,
            discount: discountAmount,
            totalCost: finalPrice,
            orderDate: new Date().toISOString(),
            estDelivery: overloadDate.toISOString(),
            status: 'PLANNED',
            contingency: { bufferDays, spareUnits }
        };

        console.log("[Enterprise] Procurement Planned:", schedule);
        return { action: 'PROCURE', schedule };
    },

    async getNodeStatus(nodeId) {
        // Return realistic node state
        return {
            id: nodeId || 'NODE-001',
            currentLoad: 0.75,
            capacity: 1000,
            status: 'Online'
        };
    },

    async getProcurementHistory() {
        // Return existing records
        return [
            { nodeId: 'NODE-001', item: 'Router X1', qty: 5, status: 'DELIVERED', totalCost: 500, orderDate: '2025-12-01T10:00:00Z' },
            { nodeId: 'NODE-002', item: 'Antenna v2', qty: 12, status: 'PLANNED', totalCost: 1200, orderDate: '2026-01-15T14:30:00Z' }
        ];
    },

    async getROIStats() {
        return {
            costPerGB: '$0.04',
            roiPeriod: '6 Months',
            bulkSavings: '$2,450.00',
            uptime: '99.92%'
        };
    }
};

window.EnterpriseLogic = EnterpriseLogic;
