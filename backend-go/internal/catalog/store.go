package catalog

import "context"

type ProductPage struct {
	Items    []Product
	HasMore  bool
	NextName string
	NextID   string
}

type Store interface {
	CreateProduct(context.Context, Product) error
	ListProducts(context.Context, string, int, string, string) (ProductPage, error)
}

type VariantStore interface {
	CreateVariant(context.Context, Variant) error
}
type VariantPage struct {
	Items    []Variant
	HasMore  bool
	NextName string
	NextID   string
}
type VariantListStore interface {
	ListVariants(context.Context, string, int, string, string) (VariantPage, error)
}
type VariantSearchStore interface {
	SearchVariants(context.Context, string, string, int) (VariantPage, error)
}
type VariantSearchAtLocationStore interface {
	SearchVariantsAtLocation(context.Context, string, string, string, int) (VariantPage, error)
}
type ProductUpdateStore interface {
	UpdateProduct(context.Context, Product) error
	DeleteProduct(context.Context, string, string) error
}
type VariantUpdateStore interface {
	UpdateVariant(context.Context, Variant) error
	DeleteVariant(context.Context, string, string) error
}
