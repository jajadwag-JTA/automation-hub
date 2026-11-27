// Package workflows defines the structured workflow of a project:
// a trigger, ordered steps, the systems they touch, and the outputs.
package workflows

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

// TODO: Validate (unique ids, next refs exist, one start) and ToMermaid for the UI.
