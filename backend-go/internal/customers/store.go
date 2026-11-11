package customers

import "context"

type Page struct {
	Items                 []Customer
	HasMore               bool
	NextCreatedAt, NextID string
}
type Store interface {
	Create(context.Context, Customer) error
	List(context.Context, string, int, string, string) (Page, error)
	Update(context.Context, string, Customer) error
	Delete(context.Context, string, string) error
}
