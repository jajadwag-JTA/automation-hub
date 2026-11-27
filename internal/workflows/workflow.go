// Package workflows defines the structured workflow of a project:
// a trigger, ordered steps, the systems they touch, and the outputs.
package workflows

import "fmt"

type Workflow struct {
	Trigger Trigger  `json:"trigger" yaml:"trigger"`
	Steps   []Step   `json:"steps" yaml:"steps"`
	Outputs []string `json:"outputs" yaml:"outputs"`
}

type Trigger struct {
	Type string `json:"type" yaml:"type"` // schedule | webhook | manual | event
	Spec string `json:"spec" yaml:"spec"` // e.g. cron expression
}

type Step struct {
	ID     string   `json:"id" yaml:"id"`
	Name   string   `json:"name" yaml:"name"`
	Type   string   `json:"type" yaml:"type"`     // fetch | transform | decide | write | notify | manual
	System string   `json:"system" yaml:"system"` // the tool or service involved
	Next   []string `json:"next" yaml:"next"`     // step ids; more than one = branch
	Notes  string   `json:"notes" yaml:"notes"`
}

// Validate checks the trigger type, that step ids are unique, and that every
// "next" points at a step that exists.
func (w Workflow) Validate() error {
	switch w.Trigger.Type {
	case "schedule", "webhook", "manual", "event":
	default:
		return fmt.Errorf("trigger.type %q must be schedule, webhook, manual or event", w.Trigger.Type)
	}
	ids := map[string]bool{}
	for _, s := range w.Steps {
		if s.ID == "" {
			return fmt.Errorf("every step needs an id")
		}
		if ids[s.ID] {
			return fmt.Errorf("duplicate step id %q", s.ID)
		}
		ids[s.ID] = true
	}
	for _, s := range w.Steps {
		for _, n := range s.Next {
			if !ids[n] {
				return fmt.Errorf("step %q points to unknown step %q", s.ID, n)
			}
		}
	}
	return nil
}

// TODO: ToMermaid for the UI.
