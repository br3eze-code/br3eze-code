package controllers

import (
	"context"
	"encoding/json"
	"bytes"
	"net/http"

	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	agentosv1alpha1 "github.com/br3eze6/agentos-operator/api/v1alpha1"
)

type ApprovalReconciler struct {
	client.Client
	Scheme *runtime.Scheme
	AgentOSURL string // http://agentos.agentos.svc:3000
}

func (r *ApprovalReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := log.FromContext(ctx)
	var approval agentosv1alpha1.Approval
	if err := r.Get(ctx, req.NamespacedName, &approval); err!= nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// If already decided, notify AgentOS and return
	if approval.Status.State == "Approved" || approval.Status.State == "Denied" {
		return ctrl.Result{}, r.notifyAgentOS(ctx, &approval)
	}

	// New approval: set to Pending
	if approval.Status.State == "" {
		approval.Status.State = "Pending"
		if err := r.Status().Update(ctx, &approval); err!= nil {
			return ctrl.Result{}, err
		}
		log.Info("Approval created", "tool", approval.Spec.Tool, "user", approval.Spec.User)
	}

	return ctrl.Result{}, nil
}

func (r *ApprovalReconciler) notifyAgentOS(ctx context.Context, a *agentosv1alpha1.Approval) error {
	body, _ := json.Marshal(map[string]string{
		"id": a.Name,
		"decision": a.Status.State,
		"decidedBy": a.Status.DecidedBy,
	})
	req, _ := http.NewRequest("POST", r.AgentOSURL+"/internal/approvals/callback", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AgentOS-Secret", "shared-secret") // mTLS better
	_, err := http.DefaultClient.Do(req)
	return err
}

func (r *ApprovalReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&agentosv1alpha1.Approval{}).
		Complete(r)
}
