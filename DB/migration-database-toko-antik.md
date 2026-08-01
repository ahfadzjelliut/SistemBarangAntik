# Migration Laravel — Toko Barang Antik

Migration lengkap sesuai ERD final (19 tabel). Urutan di bawah ini penting karena ada dependency foreign key — bikin file migration sesuai urutan ini (nama file pakai timestamp naik) biar `php artisan migrate` gak error "table doesn't exist yet".

## Cara Pakai
1. Copy tiap blok kode ke file baru di `database/migrations/`, kasih nama sesuai judul section (contoh: `2026_07_21_000003_create_seller_profiles_table.php`).
2. Jalankan `php artisan migrate`.
3. Bagian **Catatan Tambahan** di akhir berisi contoh model cast (enkripsi), PHP enum, dan trik constraint lanjutan — gak wajib langsung dipakai, tapi disarankan sebelum production.

## Keputusan Desain di Migration Ini
- **Status pakai `string`, bukan `enum()` MySQL** — sesuai hasil audit sebelumnya, biar nambah status baru gak perlu `ALTER TABLE`. Validasi nilai yang boleh dilakukan di Form Request / PHP enum class (contoh di Catatan Tambahan).
- **Semua kolom uang pakai `decimal(12, 2)`** — hindari floating point error.
- **CHECK constraint** ditambah lewat `DB::statement()` raw SQL (butuh MySQL 8.0.16+) buat aturan yang gak bisa dijamin di level aplikasi aja.
- **Strategi FK `onDelete`** — lihat tabel ringkasan di bawah sebelum baca kode satu-satu.

### Ringkasan Strategi Foreign Key

| Tabel.kolom | Merujuk ke | Aksi delete | Alasan |
|---|---|---|---|
| seller_profiles.user_id | users | cascade | profil toko cuma ekstensi 1-1 dari user |
| addresses.user_id | users | cascade | alamat gak berguna tanpa pemiliknya |
| items.seller_id | users | **restrict** | cegah user dihapus kalau masih ada barang aktif — harus diberesin dulu |
| items.category_id | categories | set null | kategori opsional, hapus kategori gak boleh ikut hapus barang |
| item_images.item_id | items | cascade | gambar gak berguna tanpa barangnya |
| item_tag.* | items / tags | cascade | data pivot murni |
| carts.user_id | users | cascade | |
| cart_items.* | carts / items | cascade | data keranjang murni derived |
| negotiations.item_id, buyer_id, seller_id | items / users | **restrict** | data historis nego harus tetap ada buat audit |
| negotiation_offers.negotiation_id | negotiations | cascade | histori chat ikut nego induknya |
| negotiation_offers.sender_id | users | restrict | |
| orders.buyer_id | users | restrict | data transaksi finansial, jangan ikut hilang |
| orders.shipping_address_id | addresses | set null | cuma referensi/jejak, bukan sumber utama (udah di-snapshot) |
| order_items.order_id | orders | cascade | baris item ikut order induknya |
| order_items.item_id, seller_id | items / users | restrict | jaga integritas data histori transaksi |
| order_items.negotiation_id | negotiations | set null | opsional, cuma penanda asal harga |
| payments.order_id, shipments.order_id | orders | cascade | |
| reviews.order_item_id | order_items | cascade | | 
| reviews.buyer_id, seller_id, item_id | users / items | restrict | |
| wishlists.* | users / items | cascade | data preferensi murni, aman ikut kehapus |

---

## 1. Modifikasi Tabel `users`

Laravel udah nyediain migration default buat `users` (name, email, password, timestamps). Kita tambah kolom yang dibutuhin lewat migration baru — jangan edit file migration default-nya langsung.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone')->nullable()->after('email');
            $table->string('role')->default('user')->after('phone'); // 'admin' | 'user'
            $table->string('avatar')->nullable()->after('role');
            $table->softDeletes(); // soft delete + anonymize, jangan hard delete user yang punya riwayat transaksi
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['phone', 'role', 'avatar', 'deleted_at']);
        });
    }
};
```

---

## 2. `platform_settings`

Tabel konfigurasi singleton — didesain cuma nyimpen **1 baris**. Sumber `commission_percent` yang dipakai buat snapshot di `order_items` nanti.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_settings', function (Blueprint $table) {
            $table->id();
            $table->decimal('commission_percent', 5, 2)->default(5.00);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_settings');
    }
};
```

> Isi baris pertamanya lewat seeder — contoh ada di bagian Catatan Tambahan.

---

## 3. `seller_profiles`

`id_number` dan kolom bank **wajib dienkripsi** di level model (lihat Catatan Tambahan) — migration cuma nyiapin kolomnya sebagai `string`, enkripsi terjadi otomatis lewat Eloquent cast, bukan di migration.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seller_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('store_name');
            $table->text('store_description')->nullable();
            $table->string('id_number')->nullable(); // NIK — enkripsi via model cast
            $table->boolean('is_verified')->default(false);
            $table->string('bank_name')->nullable();
            $table->string('bank_account_number')->nullable(); // enkripsi via model cast
            $table->string('bank_account_name')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_profiles');
    }
};
```

---

## 4. `addresses`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('label')->nullable();
            $table->string('recipient_name');
            $table->string('phone');
            $table->string('province');
            $table->string('city');
            $table->string('district');
            $table->string('subdistrict')->nullable();
            $table->string('postal_code');
            $table->text('full_address');
            $table->boolean('is_primary')->default(false);
            $table->timestamps();

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('addresses');
    }
};
```

---

## 5. `categories`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->foreignId('parent_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->unsignedInteger('default_weight_grams')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};
```

---

## 6. `tags`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tags', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tags');
    }
};
```

---

## 7. `items`

Tabel paling kompleks — `reserved_quantity` cuma naik pas negosiasi di-approve (bukan pas bid dibuat), `min_acceptable_price` privat dan gak boleh keluar lewat API publik. Tiga `CHECK` constraint ditambah manual pakai `DB::statement()`.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('category_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->string('name');
            $table->text('description'); // cerita bebas: sejarah, kondisi, perkiraan tahun, dll
            $table->string('condition')->default('bekas_baik'); // baru | bekas_baik | perlu_perbaikan
            $table->decimal('price', 12, 2);
            $table->unsignedInteger('quantity')->default(1); // total stok
            $table->unsignedInteger('reserved_quantity')->default(0); // cuma naik saat bid di-approve
            $table->unsignedInteger('weight_grams')->nullable(); // nullable, fallback ke default kategori
            $table->string('location_city')->nullable(); // denormalized dari alamat penjual
            $table->string('status')->default('available'); // available | reserved | sold | inactive
            $table->boolean('is_negotiable')->default(false);
            $table->decimal('min_acceptable_price', 12, 2)->nullable(); // PRIVAT — jangan expose ke API
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'category_id']);
            $table->index('seller_id');
            $table->fullText(['name', 'description']);
        });

        // CHECK constraint — butuh MySQL 8.0.16+
        DB::statement('ALTER TABLE items ADD CONSTRAINT chk_items_quantity CHECK (quantity >= 0)');
        DB::statement('ALTER TABLE items ADD CONSTRAINT chk_items_reserved CHECK (reserved_quantity <= quantity)');
        DB::statement('ALTER TABLE items ADD CONSTRAINT chk_items_price CHECK (price > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
```

---

## 8. `item_images`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->boolean('is_primary')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index('item_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_images');
    }
};
```

---

## 9. `item_tag` (pivot)

Primary key composite `(item_id, tag_id)` — gak butuh kolom `id` sendiri, otomatis cegah kombinasi ganda.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_tag', function (Blueprint $table) {
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained()->cascadeOnDelete();

            $table->primary(['item_id', 'tag_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_tag');
    }
};
```

---

## 10. `carts`

`user_id` unique — 1 user cuma boleh punya 1 cart.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carts');
    }
};
```

---

## 11. `cart_items`

Unique `(cart_id, item_id)` — nambah barang yang sama harusnya update `quantity`, bukan insert baris baru.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cart_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cart_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('quantity')->default(1);
            $table->timestamps();

            $table->unique(['cart_id', 'item_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cart_items');
    }
};
```

---

## 12. `negotiations`

Index `(item_id, status)` paling kritis di seluruh skema — dipakai tiap kali validasi approve bid ("berapa stok tersedia buat item ini sekarang").

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('negotiations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->foreignId('buyer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('listing_price', 12, 2);
            $table->decimal('current_offer_price', 12, 2);
            $table->string('offered_by'); // buyer | seller
            $table->string('status')->default('pending'); // pending|countered|accepted|rejected|expired|cancelled
            $table->decimal('agreed_price', 12, 2)->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['item_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('negotiations');
    }
};
```

---

## 13. `negotiation_offers`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('negotiation_offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('negotiation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $table->decimal('offer_price', 12, 2)->nullable();
            $table->text('message')->nullable();
            $table->timestamps();

            $table->index('negotiation_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('negotiation_offers');
    }
};
```

---

## 14. `orders`

Kolom `shipping_*` adalah **snapshot** alamat saat checkout — `shipping_address_id` cuma jejak referensi, bukan sumber utama data pengiriman (lihat diskusi sebelumnya soal kenapa gak boleh cuma FK).

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_number')->unique();
            $table->foreignId('buyer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('shipping_address_id')->nullable()->constrained('addresses')->nullOnDelete();
            $table->string('shipping_recipient_name'); // snapshot, boleh beda dari address aslinya
            $table->string('shipping_phone');
            $table->text('shipping_full_address');
            $table->string('shipping_city');
            $table->string('shipping_postal_code');
            $table->string('status')->default('menunggu_pembayaran');
            $table->decimal('subtotal', 12, 2);
            $table->decimal('shipping_cost', 12, 2)->default(0);
            $table->decimal('total', 12, 2);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['buyer_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
```

---

## 15. `order_items`

`commission_percent` adalah snapshot — jangan hitung ulang komisi pesanan lama pakai `platform_settings.commission_percent` yang sekarang, karena bisa aja udah berubah.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('negotiation_id')->nullable()->constrained('negotiations')->nullOnDelete();
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('price_at_purchase', 12, 2); // snapshot harga satuan
            $table->decimal('commission_percent', 5, 2); // snapshot komisi platform saat itu
            $table->decimal('payout_amount', 12, 2); // (price_at_purchase x quantity) - komisi
            $table->timestamps();

            $table->index('order_id');
            $table->index('item_id');
            $table->index('seller_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
```

---

## 16. `payments`

`payment_proof` cuma nyimpen path — file aslinya wajib disimpan di **private disk** dan diakses lewat signed temporary URL, jangan public path (lihat Catatan Tambahan).

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('method'); // transfer_bank | e_wallet | virtual_account | cod
            $table->string('status')->default('pending'); // pending|paid|failed|refunded
            $table->decimal('amount', 12, 2);
            $table->string('payment_proof')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index('order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
```

---

## 17. `shipments`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('courier');
            $table->string('tracking_number')->nullable();
            $table->string('status')->default('menunggu'); // menunggu|dikirim|diterima
            $table->timestamp('shipped_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();

            $table->index('order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipments');
    }
};
```

---

## 18. `reviews`

Unique `order_item_id` — satu review per pembelian. `CHECK` constraint jaga `rating` selalu 1-5 walau ada bug validasi di aplikasi.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_item_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('buyer_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->unsignedTinyInteger('rating');
            $table->text('comment')->nullable();
            $table->timestamps();

            $table->index('seller_id');
            $table->index('item_id');
        });

        DB::statement('ALTER TABLE reviews ADD CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)');
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
```

---

## 19. `wishlists`

Unique `(user_id, item_id)` — cegah barang yang sama masuk wishlist dua kali.

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wishlists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'item_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wishlists');
    }
};
```

---

## Catatan Tambahan

### 1. Enkripsi kolom sensitif (`SellerProfile` model)
Migration cuma nyiapin kolom `string` biasa — enkripsinya kejadian otomatis lewat Eloquent cast di model, dan `$hidden` mencegah kolom ini ikut ke response API tanpa sengaja.

```php
class SellerProfile extends Model
{
    protected $casts = [
        'id_number' => 'encrypted',
        'bank_account_number' => 'encrypted',
        'bank_account_name' => 'encrypted',
    ];

    protected $hidden = [
        'id_number',
        'bank_account_number',
        'bank_account_name',
    ];
}
```

### 2. PHP Enum buat validasi status (pengganti ENUM database)
Kolom `status` di migration sengaja `string`. Validasi nilai yang diperbolehkan pakai native PHP enum di level aplikasi:

```php
enum OrderStatus: string
{
    case MenungguPembayaran = 'menunggu_pembayaran';
    case Diproses = 'diproses';
    case Dikirim = 'dikirim';
    case Selesai = 'selesai';
    case Dibatalkan = 'dibatalkan';
}
```

Lalu di model `Order`:
```php
protected $casts = [
    'status' => OrderStatus::class,
];
```

Bikin enum serupa buat `NegotiationStatus`, `PaymentStatus`, `ShipmentStatus`, `ItemStatus`, `ItemCondition`.

### 3. Trik "satu buyer maksimal 1 bid aktif per item"
MySQL gak punya *partial unique index* asli kayak PostgreSQL. Solusinya pakai **virtual generated column** — nilainya `NULL` kalau status bukan aktif, dan MySQL ngebolehin banyak `NULL` di kolom unique:

```php
Schema::table('negotiations', function (Blueprint $table) {
    $table->string('active_lock')->nullable()->virtualAs(
        "IF(status IN ('pending','countered'), CONCAT(item_id, '-', buyer_id), NULL)"
    );
    $table->unique('active_lock');
});
```

Begitu status berubah jadi `accepted`/`rejected`/`expired`/`cancelled`, `active_lock` otomatis balik `NULL` dan buyer itu bisa bid lagi di item yang sama.

### 4. Seeder `platform_settings`
```php
use App\Models\PlatformSetting;

class PlatformSettingSeeder extends Seeder
{
    public function run(): void
    {
        PlatformSetting::firstOrCreate([], ['commission_percent' => 5.00]);
    }
}
```

### 5. Storage `payment_proof` — private disk + signed URL
Di `config/filesystems.php`, pastikan pakai disk `local` (bukan `public`) buat bukti transfer:

```php
// simpan
$path = $request->file('proof')->store('payment-proofs', 'local');

// generate signed URL sementara (kadaluarsa otomatis)
$url = Storage::disk('local')->temporaryUrl(
    $path, now()->addMinutes(10)
);
```

Jangan pernah expose `payment_proof` path langsung lewat URL publik permanen.
