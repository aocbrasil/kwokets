<?php

declare(strict_types=1);

/**
 * Minimal RFC2822/MIME parser. No ext-imap required.
 * Handles: plain text, multipart, base64, quoted-printable, RFC2047 headers.
 */
class MimeParser
{
    /** @var array<string, string[]> */
    private array $headers = [];
    private string $rawBody = '';

    public function __construct(string $raw)
    {
        [$headerSection, $this->rawBody] = $this->splitHeaderBody($raw);
        $this->parseHeaders($headerSection);
    }

    // ---- Public API ----

    public function getHeader(string $name): string
    {
        $vals = $this->headers[strtolower($name)] ?? [];
        return isset($vals[0]) ? $this->decodeMimeWords(trim($vals[0])) : '';
    }

    public function getMessageId(): string
    {
        return trim($this->headers['message-id'][0] ?? '');
    }

    /** Returns ['address' => 'x@y', 'personal' => 'Name', 'mailbox' => 'x', 'host' => 'y'] */
    public function getFrom(): array
    {
        return $this->parseAddress($this->headers['from'][0] ?? '');
    }

    /** Decoded plain-text body. Falls back to HTML→stripped. Handles nested multipart. */
    public function getTextBody(): string
    {
        $ct      = $this->headers['content-type'][0] ?? 'text/plain';
        $enc     = strtolower(trim($this->headers['content-transfer-encoding'][0] ?? ''));
        $charset = $this->extractCharset($ct);
        return $this->extractText($ct, $enc, $charset, $this->rawBody);
    }

    private function extractText(string $ct, string $enc, string $charset, string $body): string
    {
        if (stripos($ct, 'multipart/') !== false) {
            $boundary = $this->extractBoundary($ct);
            if ($boundary === '') return '';
            $parts = $this->splitParts($body, $boundary);

            // First pass: recurse into nested multipart or grab text/plain
            foreach ($parts as $p) {
                if (stripos($p['ct'], 'multipart/') !== false) {
                    $result = $this->extractText($p['ct'], $p['enc'], $p['charset'], $p['body']);
                    if ($result !== '') return $result;
                }
                if (stripos($p['ct'], 'text/plain') !== false) {
                    $decoded = $this->decodeBody($p['body'], $p['enc']);
                    return $this->toUtf8($decoded, $p['charset']);
                }
            }
            // Second pass: text/html fallback
            foreach ($parts as $p) {
                if (stripos($p['ct'], 'text/html') !== false) {
                    $decoded = $this->decodeBody($p['body'], $p['enc']);
                    return strip_tags($this->toUtf8($decoded, $p['charset']));
                }
            }
            return '';
        }

        if (stripos($ct, 'text/plain') !== false) {
            return $this->toUtf8($this->decodeBody($body, $enc), $charset);
        }
        if (stripos($ct, 'text/html') !== false) {
            return strip_tags($this->toUtf8($this->decodeBody($body, $enc), $charset));
        }
        return '';
    }

    private function toUtf8(string $text, string $charset): string
    {
        $charset = strtolower(trim($charset));
        if ($charset === '' || $charset === 'utf-8') {
            $clean = @iconv('UTF-8', 'UTF-8//IGNORE', $text);
            return $clean !== false ? $clean : $text;
        }
        $converted = @iconv($charset, 'UTF-8//IGNORE', $text);
        return $converted !== false ? $converted : $text;
    }

    private function extractCharset(string $ct): string
    {
        if (preg_match('/charset="?([^";]+)"?/i', $ct, $m)) return trim($m[1]);
        return 'utf-8';
    }

    /**
     * @return array{filename: string, mime: string, data: string}[]
     */
    public function getAttachments(): array
    {
        $ct = $this->headers['content-type'][0] ?? '';
        if (stripos($ct, 'multipart/') === false) return [];

        $boundary = $this->extractBoundary($ct);
        if ($boundary === '') return [];

        $parts  = $this->splitParts($this->rawBody, $boundary);
        $result = [];

        foreach ($parts as $p) {
            $dispBase = strtok($p['disp'] ?: '', ';');
            $disp     = strtolower(trim($dispBase === false ? '' : $dispBase));
            $isAttach = in_array($disp, ['attachment', 'inline'], true);
            $isText   = stripos($p['ct'], 'text/') !== false;

            if (!$isAttach || ($disp === 'inline' && $isText)) continue;

            $data = $this->decodeBody($p['body'], $p['enc']);
            if (strlen($data) === 0) continue;

            $result[] = [
                'filename' => $this->decodeMimeWords($p['filename'] ?: 'attachment'),
                'mime'     => (($tok = strtok(trim($p['ct']), ';')) !== false ? trim($tok) : '') ?: 'application/octet-stream',
                'data'     => $data,
            ];
        }

        return $result;
    }

    // ---- Internals ----

    private function splitHeaderBody(string $raw): array
    {
        foreach (["\r\n\r\n", "\n\n"] as $sep) {
            $pos = strpos($raw, $sep);
            if ($pos !== false) {
                return [substr($raw, 0, $pos), substr($raw, $pos + strlen($sep))];
            }
        }
        return [$raw, ''];
    }

    private function parseHeaders(string $section): void
    {
        // Unfold continuation lines
        $section = preg_replace("/\r\n([ \t])/", '$1', $section);
        $section = preg_replace("/\n([ \t])/",   '$1', $section);

        foreach (preg_split('/\r?\n/', $section) as $line) {
            if (!str_contains($line, ':')) continue;
            [$name, $value] = explode(':', $line, 2);
            $key = strtolower(trim($name));
            if ($key !== '') {
                $this->headers[$key][] = $value;
            }
        }
    }

    /**
     * @return array{ct: string, enc: string, disp: string, filename: string, body: string}[]
     */
    private function splitParts(string $body, string $boundary): array
    {
        $delim = '--' . $boundary;
        $parts = preg_split('/' . preg_quote($delim, '/') . '(?:--)?[ \t]*\r?\n/', $body);
        array_shift($parts); // preamble

        $result = [];
        foreach ($parts as $raw) {
            $raw  = ltrim($raw, "\r\n");
            $info = $this->parsePartHeaders($raw);
            if ($info === null) continue;
            $result[] = $info;
        }
        return $result;
    }

    /** @return array{ct: string, enc: string, disp: string, filename: string, body: string}|null */
    private function parsePartHeaders(string $raw): ?array
    {
        [$hSection, $body] = $this->splitHeaderBody($raw);
        if ($hSection === '' && $body === '') return null;

        $hSection = preg_replace("/\r\n([ \t])/", '$1', $hSection);
        $hSection = preg_replace("/\n([ \t])/",   '$1', $hSection);

        $ct   = '';
        $enc  = '';
        $disp = '';
        $name = '';

        foreach (preg_split('/\r?\n/', $hSection) as $line) {
            $low = strtolower($line);
            if (str_starts_with($low, 'content-type:')) {
                $ct = substr($line, 13);
                if (preg_match('/name="?([^";]+)"?/i', $line, $m)) $name = $m[1];
            } elseif (str_starts_with($low, 'content-transfer-encoding:')) {
                $enc = strtolower(trim(substr($line, 26)));
            } elseif (str_starts_with($low, 'content-disposition:')) {
                $disp = substr($line, 20);
                if (preg_match('/filename="?([^";]+)"?/i', $line, $m)) $name = $m[1];
            }
        }

        return [
            'ct'       => trim($ct),
            'enc'      => trim($enc),
            'charset'  => $this->extractCharset($ct),
            'disp'     => trim($disp),
            'filename' => $name,
            'body'     => rtrim($body, "\r\n"),
        ];
    }

    private function extractBoundary(string $ct): string
    {
        if (preg_match('/boundary="([^"]+)"/i', $ct, $m)) return $m[1];
        if (preg_match('/boundary=([^\s;]+)/i',  $ct, $m)) return trim($m[1], '"\'');
        return '';
    }

    private function decodeBody(string $data, string $enc): string
    {
        return match ($enc) {
            'base64'           => base64_decode(trim($data)),
            'quoted-printable' => quoted_printable_decode($data),
            default            => $data,
        };
    }

    public function decodeMimeWords(string $str): string
    {
        // RFC2047: =?charset?B|Q?encoded?=
        $decoded = preg_replace_callback(
            '/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/',
            function (array $m): string {
                $data = strtolower($m[2]) === 'b'
                    ? base64_decode($m[3])
                    : quoted_printable_decode(str_replace('_', ' ', $m[3]));
                // Convert to UTF-8 if mbstring available, otherwise return as-is
                // (UTF-8 encoded headers — common for modern mail — work without conversion)
                $charset = strtolower(trim($m[1]));
                if ($charset === 'utf-8' || $charset === 'us-ascii') {
                    return $data;
                }
                if (function_exists('mb_convert_encoding')) {
                    return mb_convert_encoding($data, 'UTF-8', $m[1]);
                }
                if (function_exists('iconv')) {
                    $converted = @iconv($m[1], 'UTF-8//IGNORE', $data);
                    return $converted !== false ? $converted : $data;
                }
                return $data; // best effort — return raw bytes
            },
            $str
        );
        return $decoded ?? $str;
    }

    private function parseAddress(string $raw): array
    {
        $raw = $this->decodeMimeWords(trim($raw));

        // "Name" <email@host>
        if (preg_match('/^(.+?)\s*<([^>]+)>/', $raw, $m)) {
            [$mb, $host] = array_pad(explode('@', trim($m[2]), 2), 2, '');
            return [
                'personal' => trim($m[1], ' "\''),
                'mailbox'  => $mb,
                'host'     => $host,
                'address'  => trim($m[2]),
            ];
        }

        // Plain email
        [$mb, $host] = array_pad(explode('@', $raw, 2), 2, '');
        return [
            'personal' => '',
            'mailbox'  => $mb,
            'host'     => $host,
            'address'  => $raw,
        ];
    }
}
