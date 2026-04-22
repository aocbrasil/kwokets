<?php

declare(strict_types=1);

/**
 * Minimal TLS IMAP client using PHP stream sockets.
 * Replaces ext/imap (removed in PHP 8.4+).
 */
class ImapSocket
{
    /** @var resource|null */
    private $fp = null;
    private int $seq = 0;
    public string $lastError = '';

    // ---- Connection ----

    public function connect(string $host, int $port, bool $ssl = true): bool
    {
        $ctx = stream_context_create([
            'ssl' => [
                'verify_peer'      => false,
                'verify_peer_name' => false,
            ],
        ]);
        $scheme    = $ssl ? 'tls' : 'tcp';
        $this->fp  = stream_socket_client(
            "{$scheme}://{$host}:{$port}", $errno, $errstr, 30,
            STREAM_CLIENT_CONNECT, $ctx
        );
        if ($this->fp === false) {
            $this->lastError = "Connect [{$errno}]: {$errstr}";
            return false;
        }
        stream_set_timeout($this->fp, 30);
        $this->readline(); // server greeting
        return true;
    }

    public function login(string $user, string $pass): bool
    {
        $resp = $this->cmd(sprintf('LOGIN %s %s', $this->quote($user), $this->quote($pass)));
        return $this->isOk($resp);
    }

    public function selectMailbox(string $mailbox): bool
    {
        $resp = $this->cmd('SELECT ' . $this->quote($mailbox));
        return $this->isOk($resp);
    }

    // ---- Search ----

    /** @return int[] */
    public function searchUnseen(): array
    {
        return $this->search('UNSEEN');
    }

    /** @return int[] */
    public function searchAll(): array
    {
        return $this->search('ALL');
    }

    /** @return int[] */
    private function search(string $criteria): array
    {
        $resp = $this->cmd("SEARCH {$criteria}");
        foreach (explode("\n", $resp) as $line) {
            $line = rtrim($line, "\r");
            if (str_starts_with($line, '* SEARCH')) {
                $nums = trim(substr($line, 8));
                return $nums === '' ? [] : array_map('intval', explode(' ', $nums));
            }
        }
        return [];
    }

    // ---- Fetch ----

    /**
     * Fetch the full raw RFC822 message.
     * Returns the message bytes exactly as the server sent them.
     */
    public function fetchRfc822(int $num): string
    {
        // BODY.PEEK[] is identical to RFC822 but does NOT auto-set \Seen
        $tag = 'T' . (++$this->seq);
        fwrite($this->fp, "{$tag} FETCH {$num} BODY.PEEK[]\r\n");

        $message = '';
        while (true) {
            $line = fgets($this->fp, 8192);
            if ($line === false) break;

            // Literal: {N}\r\n → read exactly N bytes
            // Server responds with BODY[] (not BODY.PEEK[]) in the untagged line
            if (preg_match('/\{(\d+)\}\s*$/', rtrim($line, "\r\n"), $m)) {
                $need    = (int)$m[1];
                $message = '';
                while (strlen($message) < $need) {
                    $chunk = fread($this->fp, $need - strlen($message));
                    if ($chunk === false || $chunk === '') break;
                    $message .= $chunk;
                }
                // Drain remaining FETCH response lines until tagged OK
                while (true) {
                    $l = fgets($this->fp, 8192);
                    if ($l === false) break;
                    if (str_starts_with($l, "{$tag} ")) break;
                }
                return $message;
            }

            // Tagged completion (no literal found — shouldn't happen for RFC822)
            if (str_starts_with($line, "{$tag} ")) break;
        }

        return $message;
    }

    // ---- Flag ----

    public function setFlag(int $num, string $flag): void
    {
        $this->cmd("STORE {$num} +FLAGS ({$flag})");
    }

    // ---- Close ----

    public function close(): void
    {
        if ($this->fp) {
            $tag = 'T' . (++$this->seq);
            @fwrite($this->fp, "{$tag} LOGOUT\r\n");
            fclose($this->fp);
            $this->fp = null;
        }
    }

    // ---- Helpers ----

    private function cmd(string $cmd): string
    {
        $tag = 'T' . (++$this->seq);
        fwrite($this->fp, "{$tag} {$cmd}\r\n");
        return $this->readResponse($tag);
    }

    private function readResponse(string $tag): string
    {
        $buf = '';
        while (true) {
            $line = $this->readline();
            if ($line === null) break;
            $buf .= $line . "\n";

            // Handle literal
            if (preg_match('/\{(\d+)\}\s*$/', $line, $m)) {
                $need = (int)$m[1];
                $data = '';
                while (strlen($data) < $need) {
                    $chunk = fread($this->fp, $need - strlen($data));
                    if ($chunk === false || $chunk === '') break;
                    $data .= $chunk;
                }
                $buf .= $data;
                continue;
            }

            if (str_starts_with($line, "{$tag} OK")
                || str_starts_with($line, "{$tag} NO")
                || str_starts_with($line, "{$tag} BAD")) {
                break;
            }
        }
        return $buf;
    }

    private function readline(): ?string
    {
        $line = fgets($this->fp, 8192);
        return $line === false ? null : rtrim($line, "\r\n");
    }

    private function quote(string $s): string
    {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    private function isOk(string $resp): bool
    {
        foreach (explode("\n", $resp) as $line) {
            if (preg_match('/^T\d+ OK/i', $line)) return true;
            if (preg_match('/^T\d+ (?:NO|BAD) (.+)/i', $line, $m)) {
                $this->lastError = trim($m[1]);
            }
        }
        return false;
    }
}
