package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type server struct {
	addr           string
	baseURL        string
	dataDir        string
	tokens         []string
	privacyFile    string
	privacyContact string
}

type createTicketRequest struct {
	Source      string          `json:"source"`
	Version     string          `json:"version"`
	Comment     string          `json:"comment"`
	Screenshot  json.RawMessage `json:"screenshot"`
	Screenshots json.RawMessage `json:"screenshots"`
	Attachments json.RawMessage `json:"attachments"`
	Metadata    json.RawMessage `json:"metadata"`
}

type ticket struct {
	ID          string          `json:"id"`
	CreatedAt   string          `json:"createdAt"`
	Source      string          `json:"source"`
	Version     string          `json:"version"`
	Comment     string          `json:"comment"`
	Screenshot  json.RawMessage `json:"screenshot,omitempty"`
	Screenshots json.RawMessage `json:"screenshots,omitempty"`
	Attachments json.RawMessage `json:"attachments,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
}

type createTicketResponse struct {
	ID  string `json:"id"`
	URL string `json:"url,omitempty"`
}

var ticketIDPattern = regexp.MustCompile(`^FRAMI-[A-Z0-9]{6}$`)

func main() {
	addr := flag.String("addr", envOr("FRAMI_ADDR", ":8787"), "listen address")
	baseURL := flag.String("base-url", envOr("FRAMI_BASE_URL", "http://127.0.0.1:8787"), "public base URL")
	dataDir := flag.String("data-dir", envOr("FRAMI_DATA_DIR", "/opt/frami/data"), "data directory")
	tokenFile := flag.String("token-file", envOr("FRAMI_TOKEN_FILE", "/opt/frami/tokens"), "newline-delimited bearer token file")
	privacyFile := flag.String("privacy-file", envOr("FRAMI_PRIVACY_FILE", "/opt/frami/privacy-policy.html"), "privacy policy HTML file")
	privacyContact := flag.String("privacy-contact", envOr("FRAMI_PRIVACY_CONTACT", "privacy@kenkai.io"), "privacy contact email")
	flag.Parse()

	tokens, err := loadTokens(*tokenFile)
	if err != nil {
		log.Fatalf("load tokens: %v", err)
	}

	s := &server{
		addr:           *addr,
		baseURL:        strings.TrimRight(*baseURL, "/"),
		dataDir:        *dataDir,
		tokens:         tokens,
		privacyFile:    strings.TrimSpace(*privacyFile),
		privacyContact: strings.TrimSpace(*privacyContact),
	}

	if err := os.MkdirAll(s.ticketDir(), 0o750); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /privacy", s.handlePrivacy)
	mux.HandleFunc("POST /tickets", s.withAuth(s.handleCreateTicket))
	mux.HandleFunc("GET /tickets/{id}", s.withAuth(s.handleGetTicket))

	log.Printf("frami backend listening on %s", s.addr)
	log.Printf("tickets dir: %s", s.ticketDir())
	if err := http.ListenAndServe(s.addr, mux); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "frami-backend",
	})
}

func (s *server) handlePrivacy(w http.ResponseWriter, r *http.Request) {
	if s.privacyFile != "" {
		data, err := os.ReadFile(s.privacyFile)
		if err == nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("read privacy policy %s: %v", s.privacyFile, err)
		}
	}

	contact := s.privacyContact
	if contact == "" {
		contact = "privacy@kenkai.io"
	}
	contact = html.EscapeString(contact)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Frami Privacy Policy</title>
  <style>
    body { max-width: 760px; margin: 48px auto; padding: 0 20px; color: #18212f; font: 16px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.15; }
    h2 { margin: 28px 0 8px; font-size: 18px; }
    p, ul { margin: 0 0 14px; }
    li { margin: 6px 0; }
    .muted { color: #667085; }
  </style>
</head>
<body>
  <h1>Frami Privacy Policy</h1>
  <p class="muted">Effective date: April 28, 2026</p>

  <p>Frami is an internal browser extension for creating visual bug reports.</p>

  <h2>Data We Collect</h2>
  <p>Frami collects data only when a user chooses to create a ticket. This may include:</p>
  <ul>
    <li>Screenshots selected by the user</li>
    <li>User-entered comments and screenshot notes</li>
    <li>Optional image attachments selected by the user</li>
    <li>Page metadata, including page title, page URL, viewport size, scroll position, and selected crop area</li>
    <li>Frami backend URL, access token, draft screenshots, and ticket history stored locally in the browser</li>
  </ul>

  <h2>How We Use Data</h2>
  <p>We use this data only to create, store, retrieve, and review internal Frami visual bug tickets for debugging and development workflows.</p>

  <h2>How Data Is Shared</h2>
  <p>Frami sends ticket data to the configured Frami backend. We do not sell user data. We do not share user data with third parties except infrastructure providers required to operate the internal Frami service.</p>

  <h2>Data Storage</h2>
  <p>Ticket data is stored on the configured Frami backend. Local extension settings and draft data are stored in the user's browser using Chrome local storage.</p>

  <h2>Security</h2>
  <p>Frami sends ticket data over HTTPS when using the hosted Frami backend. Access to the backend requires a Frami access token.</p>

  <h2>Data Retention and Deletion</h2>
  <p>Ticket data is retained for internal debugging and development needs. Users or administrators may request deletion of Frami ticket data by contacting the Frami administrator.</p>

  <h2>Contact</h2>
  <p>For privacy questions or deletion requests, contact: <a href="mailto:%[1]s">%[1]s</a></p>
</body>
</html>
`, contact)
}

func (s *server) handleCreateTicket(w http.ResponseWriter, r *http.Request) {
	var req createTicketRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 30<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	id, err := s.nextTicketID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not allocate ticket id")
		return
	}

	t := ticket{
		ID:          id,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		Source:      req.Source,
		Version:     req.Version,
		Comment:     req.Comment,
		Screenshot:  emptyRawToNil(req.Screenshot),
		Screenshots: emptyRawToNil(req.Screenshots),
		Attachments: emptyRawToNil(req.Attachments),
		Metadata:    emptyRawToNil(req.Metadata),
	}

	if len(t.Screenshots) == 0 && len(t.Screenshot) == 0 {
		writeError(w, http.StatusBadRequest, "at least one screenshot is required")
		return
	}

	if err := s.writeTicket(t); err != nil {
		log.Printf("write ticket %s: %v", id, err)
		writeError(w, http.StatusInternalServerError, "could not save ticket")
		return
	}

	writeJSON(w, http.StatusCreated, createTicketResponse{
		ID:  id,
		URL: s.baseURL + "/tickets/" + id,
	})
}

func (s *server) handleGetTicket(w http.ResponseWriter, r *http.Request) {
	id := strings.ToUpper(r.PathValue("id"))
	if !ticketIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid ticket id")
		return
	}

	data, err := os.ReadFile(s.ticketPath(id))
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		log.Printf("read ticket %s: %v", id, err)
		writeError(w, http.StatusInternalServerError, "could not read ticket")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func (s *server) authorized(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok {
		return false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}

	for _, allowed := range s.tokens {
		if subtle.ConstantTimeCompare([]byte(token), []byte(allowed)) == 1 {
			return true
		}
	}
	return false
}

func (s *server) ticketDir() string {
	return filepath.Join(s.dataDir, "tickets")
}

func (s *server) ticketPath(id string) string {
	return filepath.Join(s.ticketDir(), id+".json")
}

func (s *server) nextTicketID() (string, error) {
	for i := 0; i < 20; i++ {
		id, err := randomTicketID()
		if err != nil {
			return "", err
		}
		if _, err := os.Stat(s.ticketPath(id)); errors.Is(err, os.ErrNotExist) {
			return id, nil
		}
	}
	return "", errors.New("could not find unused ticket id")
}

func (s *server) writeTicket(t ticket) error {
	data, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return err
	}

	path := s.ticketPath(t.ID)
	tmp, err := os.CreateTemp(s.ticketDir(), t.ID+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.WriteString("\n"); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o640); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func randomTicketID() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}

	var builder strings.Builder
	builder.WriteString("FRAMI-")
	for _, b := range bytes {
		builder.WriteByte(alphabet[int(b)%len(alphabet)])
	}
	return builder.String(), nil
}

func loadTokens(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(data), "\n")
	tokens := make([]string, 0, len(lines))
	for _, line := range lines {
		token := strings.TrimSpace(line)
		if token == "" || strings.HasPrefix(token, "#") {
			continue
		}
		tokens = append(tokens, token)
	}

	if len(tokens) == 0 {
		return nil, fmt.Errorf("%s has no tokens", path)
	}
	return tokens, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func emptyRawToNil(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return raw
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": message,
	})
}
