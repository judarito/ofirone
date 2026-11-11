package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory  = 64 * 1024
	argonTime    = 3
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

var ErrInvalidPasswordHash = errors.New("auth: invalid password hash")

func HashPassword(password string) (string, error) {
	if len(password) < 12 {
		return "", errors.New("auth: password must contain at least 12 bytes")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generate password salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argonMemory, argonTime, argonThreads, enc.EncodeToString(salt), enc.EncodeToString(hash)), nil
}

func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, ErrInvalidPasswordHash
	}
	params := map[string]uint32{}
	for _, item := range strings.Split(parts[3], ",") {
		kv := strings.SplitN(item, "=", 2)
		if len(kv) != 2 {
			return false, ErrInvalidPasswordHash
		}
		n, err := strconv.ParseUint(kv[1], 10, 32)
		if err != nil {
			return false, ErrInvalidPasswordHash
		}
		params[kv[0]] = uint32(n)
	}
	memory, mok := params["m"]
	timeCost, tok := params["t"]
	threads, pok := params["p"]
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 {
		return false, ErrInvalidPasswordHash
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) == 0 {
		return false, ErrInvalidPasswordHash
	}
	if !mok || !tok || !pok || memory < 8*1024 || memory > 512*1024 || timeCost == 0 || timeCost > 10 || threads == 0 || threads > 16 {
		return false, ErrInvalidPasswordHash
	}
	actual := argon2.IDKey([]byte(password), salt, timeCost, memory, uint8(threads), uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
