package customers

import (
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidCustomer = errors.New("customers: invalid customer")

type Customer struct {
	ID, TenantID, ThirdPartyID, LegalName, DocumentType, DocumentNumber, Email, Phone string
	CreditEnabled                                                                     bool
	CreditLimit                                                                       int64
	Active                                                                            bool
}

func (c Customer) Validate() error {
	if c.ID == "" || c.TenantID == "" || c.ThirdPartyID == "" || strings.TrimSpace(c.LegalName) == "" {
		return fmt.Errorf("%w: identity and name are required", ErrInvalidCustomer)
	}
	if c.CreditLimit < 0 {
		return fmt.Errorf("%w: negative credit limit", ErrInvalidCustomer)
	}
	if (c.DocumentType == "") != (c.DocumentNumber == "") {
		return fmt.Errorf("%w: document type and number must be paired", ErrInvalidCustomer)
	}
	return nil
}
